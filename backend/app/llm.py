"""OpenAI-compatible /v1/chat/completions endpoint — Tavus calls this as its LLM.

Flow (adapted from Artic's tool-loop pattern, using OpenAI SDK):
  1. Tavus sends conversation history (OpenAI messages format)
  2. We inject system prompt + tool definitions and call gpt-4o-mini
  3. If the model returns tool_calls → execute each (SQLite + SSE events) → loop
  4. Once we get a plain text response, stream it back in OpenAI SSE format

Session correlation: Tavus includes the session_id we embedded in
conversational_context when creating the conversation. We scan messages for
the [MYKARE_SESSION:xxx] marker.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import AsyncIterator

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from loguru import logger
from openai import AsyncOpenAI

from . import events, tools
from . import database as db
from .config import config
from .prompts import SYSTEM_PROMPT, TOOLS

_CLOSING = {"goodbye", "bye", "take care", "have a great day", "have a good day",
            "thank you for calling", "thanks for calling", "see you soon",
            "have a wonderful day", "all the best", "good day"}

def _is_closing(text: str) -> bool:
    lower = text.lower()
    return any(phrase in lower for phrase in _CLOSING)

_client = AsyncOpenAI(api_key=config.openai_api_key)

SESSION_RE = re.compile(r"\[MYKARE_SESSION:([a-zA-Z0-9_-]+)\]")
_XML_RE = re.compile(r"<[^>]+>.*?</[^>]+>", re.DOTALL)
_summaries: dict[str, dict] = {}

# Dedup: completed cache + in-flight events to prevent race-condition double execution
_dedup_cache: dict[tuple, str] = {}
_dedup_times: dict[tuple, float] = {}
_dedup_inflight: dict[tuple, asyncio.Event] = {}

# Session state: after identify_user succeeds, store user info here so we inject it
# into every subsequent system prompt — prevents LLM from calling identify_user again
_session_state: dict[str, dict] = {}  # session_id → {user_id, name, phone}


def _clean(text: str) -> str:
    """Strip Tavus-injected XML tags (user_audio_analysis, user_appearance, etc.)."""
    return _XML_RE.sub("", text).strip()


def get_summary(session_id: str) -> dict | None:
    return _summaries.get(session_id)


# conv_id → session_id reverse map for callback lookup
_conv_to_session: dict[str, str] = {}


def register_conversation(session_id: str, conv_id: str) -> None:
    _conv_to_session[conv_id] = session_id


def update_session_state(session_id: str, user_id: int, name: str, phone: str) -> None:
    """Called by tools.py after identify_user succeeds — injected into future system prompts."""
    _session_state[session_id] = {"user_id": user_id, "name": name, "phone": phone}


async def force_end_session(conv_id: str) -> None:
    """Called by Tavus callback when conversation ends — generate summary if not done."""
    session_id = _conv_to_session.get(conv_id)
    if not session_id:
        logger.warning(f"[llm] force_end: unknown conv_id={conv_id}")
        return
    if session_id in _summaries:
        return  # already done
    logger.info(f"[llm] force_end: generating summary for session={session_id}")
    summary = await _generate_summary([], session_id)
    await events.emit(session_id, {"type": "summary", "data": summary})
    await events.close(session_id)


# ---------- helpers ----------

def _extract_session(messages: list[dict]) -> str | None:
    for msg in messages:
        content = msg.get("content") or ""
        if isinstance(content, str):
            m = SESSION_RE.search(content)
            if m:
                return m.group(1)
    return None


def _openai_tools() -> list[dict]:
    """Convert our tool list (Anthropic input_schema format) to OpenAI tools format."""
    return [
        {
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            },
        }
        for t in TOOLS
    ]


# ---------- summary ----------

async def _generate_summary(messages: list[dict], session_id: str) -> dict:
    transcript_lines = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content") or ""
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            prefix = "Patient" if role == "user" else "Aria"
            transcript_lines.append(f"{prefix}: {content}")

    from datetime import date as _date
    today_str = _date.today().strftime("%Y-%m-%d (%A, %d %B %Y)")

    transcript = "\n".join(transcript_lines[-40:])
    summary_prompt = (
        f"Today's actual date is {today_str}. "
        "Use this to convert ALL relative date references in the transcript "
        "(e.g. 'tomorrow', 'next Monday', 'the 24th') to real YYYY-MM-DD dates. "
        "NEVER use placeholder years like 2023. Only use real calendar dates.\n\n"
        "Summarize this healthcare appointment call. "
        "Return ONLY a JSON object with keys: "
        "summary (2-3 sentences), "
        "appointments (list of {date (YYYY-MM-DD), time (HH:MM), action}), "
        "patient_name (string or null), "
        "phone_number (string or null), "
        "intent (primary reason for call).\n\n"
        f"Transcript:\n{transcript}"
    )

    try:
        resp = await _client.chat.completions.create(
            model=config.openai_model,
            max_tokens=512,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You are a medical call summarizer. Return valid JSON only."},
                {"role": "user", "content": summary_prompt},
            ],
        )
        data = json.loads(resp.choices[0].message.content or "{}")
    except Exception as e:
        logger.warning(f"[llm] summary generation failed: {e}")
        data = {
            "summary": "Conversation completed.",
            "appointments": [],
            "patient_name": None,
            "phone_number": None,
            "intent": "appointment management",
        }

    data["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _summaries[session_id] = data
    await db.save_summary(session_id, data)
    return data


# ---------- tool loop ----------

async def _tool_loop(messages: list[dict], session_id: str) -> str:
    """Run OpenAI with tools until we get a plain text response."""
    # Drop all Tavus-injected system messages (timezone, user_appearance, language, etc.)
    # and clean XML metadata from user speech — we supply our own system prompt.
    clean: list[dict] = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            continue
        if role == "user":
            content = _clean(str(m.get("content") or ""))
            # also strip session marker so it doesn't confuse the LLM
            content = SESSION_RE.sub("", content).strip()
            if content:
                clean.append({"role": "user", "content": content})
        elif role == "assistant":
            clean.append({"role": "assistant", "content": m.get("content") or ""})

    from datetime import date as _date
    today = _date.today().strftime("%A, %d %B %Y")  # e.g. "Monday, 23 June 2026"
    system_with_date = SYSTEM_PROMPT + f"\n\n=== TODAY'S DATE ===\nToday is {today}. Use this as the reference when converting relative dates like 'tomorrow', 'next Monday', 'this Friday'."

    # Inject known session state so LLM never re-calls identify_user
    state = _session_state.get(session_id)
    if state:
        system_with_date += (
            f"\n\n=== CURRENT PATIENT (already identified — DO NOT call identify_user again) ==="
            f"\nuser_id: {state['user_id']}"
            f"\nname: {state['name']}"
            f"\nphone: {state['phone']}"
            f"\nUse user_id={state['user_id']} in ALL tool calls for this patient."
        )

    conversation: list[dict] = [
        {"role": "system", "content": system_with_date},
        *clean,
    ]

    logger.info(f"[llm] clean conv has {len(clean)} msgs (excl system)")
    oai_tools = _openai_tools()
    end_conv = False

    for _turn in range(10):
        resp = await _client.chat.completions.create(
            model=config.openai_model,
            max_tokens=1024,
            tools=oai_tools,
            tool_choice="auto",
            parallel_tool_calls=False,
            messages=conversation,
        )

        choice = resp.choices[0]
        msg = choice.message

        logger.info(f"[llm] turn={_turn} finish_reason={choice.finish_reason} tool_calls={bool(msg.tool_calls)} content_preview={str(msg.content or '')[:80]}")

        # Add assistant message to conversation history
        conversation.append(msg.model_dump(exclude_unset=True))

        if choice.finish_reason != "tool_calls" or not msg.tool_calls:
            text = (msg.content or "").strip()
            # Auto-trigger end_conversation if LLM spoke a closing phrase but forgot to call the tool
            if text and _is_closing(text) and not end_conv:
                logger.info(f"[llm] auto-ending — closing phrase detected: {text[:60]}")
                summary = await _generate_summary(list(conversation), session_id)
                await events.emit(session_id, {"type": "summary", "data": summary})
                await events.close(session_id)
            return text

        # Execute each tool call
        for tc in msg.tool_calls:
            fn_name = tc.function.name
            try:
                fn_args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                fn_args = {}

            result_str = await tools.execute(fn_name, fn_args, session_id)

            if fn_name == "end_conversation":
                end_conv = True

            conversation.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result_str,
            })

        if end_conv:
            summary = await _generate_summary(messages, session_id)
            await events.emit(session_id, {"type": "summary", "data": summary})
            await events.close(session_id)
            # Get goodbye text
            farewell = await _client.chat.completions.create(
                model=config.openai_model,
                max_tokens=128,
                messages=conversation,
            )
            text = (farewell.choices[0].message.content or "").strip()
            return text or "Thank you for calling Mykare Health. Have a great day!"

    return "I'm sorry, something went wrong. Please try again."


# ---------- streaming ----------

async def _stream_text(text: str) -> AsyncIterator[str]:
    """Yield OpenAI SSE chunks so Tavus can stream the spoken response."""
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created = int(time.time())

    words = text.split()
    for i, word in enumerate(words):
        chunk_text = word + ("" if i == len(words) - 1 else " ")
        chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": config.openai_model,
            "choices": [{"index": 0, "delta": {"content": chunk_text}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(chunk)}\n\n"

    final = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": config.openai_model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    }
    yield f"data: {json.dumps(final)}\n\n"
    yield "data: [DONE]\n\n"


# ---------- endpoint handler ----------

async def handle_chat_completions(request: Request) -> StreamingResponse:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth[7:] != config.llm_internal_key:
        raise HTTPException(status_code=401, detail="Unauthorized")

    body = await request.json()
    messages: list[dict] = body.get("messages", [])

    session_id = _extract_session(messages) or "default"
    msg_count = len(messages)
    logger.info(f"[llm] session={session_id} messages={msg_count}")

    dedup_key = (session_id, msg_count)
    now = time.time()

    # Check completed cache first
    if dedup_key in _dedup_cache and now - _dedup_times.get(dedup_key, 0) < 10:
        logger.info(f"[llm] dedup cache hit for {dedup_key}")
        return StreamingResponse(
            _stream_text(_dedup_cache[dedup_key]),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # If same request is in-flight, wait for it then return its result
    if dedup_key in _dedup_inflight:
        logger.info(f"[llm] dedup waiting for in-flight {dedup_key}")
        try:
            await asyncio.wait_for(_dedup_inflight[dedup_key].wait(), timeout=30)
        except asyncio.TimeoutError:
            pass
        cached = _dedup_cache.get(dedup_key, "")
        return StreamingResponse(
            _stream_text(cached),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Mark as in-flight
    inflight_event = asyncio.Event()
    _dedup_inflight[dedup_key] = inflight_event

    # Emit latest user message as live transcript (strip XML + session marker)
    last_user = next(
        (m["content"] for m in reversed(messages)
         if m.get("role") == "user" and isinstance(m.get("content"), str) and m["content"].strip()),
        None,
    )
    if last_user:
        clean_user = _clean(SESSION_RE.sub("", last_user)).strip()
        if clean_user:
            await events.emit(session_id, {"type": "transcript", "role": "user", "text": clean_user})

    final_text = ""
    try:
        final_text = await _tool_loop(messages, session_id)
    finally:
        _dedup_cache[dedup_key] = final_text
        _dedup_times[dedup_key] = time.time()
        inflight_event.set()
        _dedup_inflight.pop(dedup_key, None)

    # Emit assistant response as live transcript
    if final_text:
        await events.emit(session_id, {"type": "transcript", "role": "assistant", "text": final_text})

    return StreamingResponse(
        _stream_text(final_text),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

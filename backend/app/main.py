"""Mykare AI receptionist — FastAPI app."""
import asyncio
import json
import uuid
from contextlib import asynccontextmanager

import aiosqlite
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from loguru import logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from . import events as event_bus
from .config import config
from .database import init_db, save_session, get_all_sessions
from .llm import get_summary, handle_chat_completions, force_end_session, register_conversation
from .tavus_client import create_conversation, ensure_persona

_persona_id: str | None = None

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _persona_id
    await init_db()
    try:
        _persona_id = await ensure_persona()
        logger.info(f"[app] Tavus persona ready: {_persona_id}")
    except Exception as e:
        logger.error(f"[app] Tavus persona setup failed: {e} — /api/session will fail")
    yield


app = FastAPI(title="mykare-agent", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "mykare-agent", "persona_id": _persona_id}


@app.post("/api/session")
@limiter.limit("20/minute")
async def create_session(request: Request):
    if not _persona_id:
        raise HTTPException(status_code=503, detail="Tavus persona not initialised")

    session_id = uuid.uuid4().hex
    event_bus.register(session_id)

    try:
        conv = await create_conversation(_persona_id, session_id)
    except Exception as e:
        logger.error(f"[app] create_conversation failed: {e}")
        raise HTTPException(status_code=502, detail=f"Tavus error: {e}")

    # Persist session to DB and register conv→session map
    await save_session(session_id, conv["conversation_id"])
    register_conversation(session_id, conv["conversation_id"])

    return {
        "session_id": session_id,
        "conversation_id": conv["conversation_id"],
        "conversation_url": conv["conversation_url"],
        "status": conv["status"],
    }


@app.get("/api/events/{session_id}")
async def sse_events(session_id: str):
    """SSE stream — emits transcript, tool-call events, and the final summary."""
    q = event_bus.get_queue(session_id)
    if q is None:
        q = event_bus.register(session_id)

    async def generate():
        yield "data: {\"type\": \"connected\"}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=25.0)
            except asyncio.TimeoutError:
                yield "data: {\"type\": \"ping\"}\n\n"
                continue

            yield f"data: {json.dumps(event)}\n\n"
            if event.get("type") == "close":
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/admin/stream")
async def admin_stream():
    """SSE broadcast — pushes db_update events to the Appointments page in real time."""
    q = event_bus.subscribe_admin()

    async def generate():
        yield "data: {\"type\": \"connected\"}\n\n"
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    yield "data: {\"type\": \"ping\"}\n\n"
                    continue
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            event_bus.unsubscribe_admin(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/summary/{session_id}")
async def get_call_summary(session_id: str):
    summary = get_summary(session_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not ready yet")
    return summary


@app.get("/api/admin/appointments")
async def admin_appointments():
    async with aiosqlite.connect(config.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT
                a.id, a.date, a.time_slot, a.intent, a.status, a.created_at,
                u.id   AS user_id,
                u.name AS patient_name,
                u.phone AS patient_phone
            FROM appointments a
            JOIN users u ON u.id = a.user_id
            ORDER BY a.date DESC, a.time_slot DESC
        """) as cur:
            rows = await cur.fetchall()
    return {"appointments": [dict(r) for r in rows]}


@app.get("/api/admin/stats")
async def admin_stats():
    async with aiosqlite.connect(config.db_path) as db:
        async with db.execute("SELECT COUNT(*) FROM appointments WHERE status='confirmed'") as c:
            confirmed = (await c.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM appointments WHERE status='cancelled'") as c:
            cancelled = (await c.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM users") as c:
            patients = (await c.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM call_sessions") as c:
            total_calls = (await c.fetchone())[0]
    return {"confirmed": confirmed, "cancelled": cancelled, "patients": patients, "total_calls": total_calls}


@app.get("/api/admin/sessions")
async def admin_sessions():
    sessions = await get_all_sessions(limit=50)
    return {"sessions": sessions}


@app.post("/api/callback/conversation")
async def tavus_callback(request: Request):
    """Tavus posts here when a conversation ends — auto-close any open session."""
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    event_type = body.get("event_type", "") or body.get("type", "")
    conv_id = body.get("conversation_id", "")
    logger.info(f"[callback] Tavus event={event_type} conv={conv_id}")

    if event_type in ("conversation.ended", "application.end", "participant.left"):
        await force_end_session(conv_id)

    return {"ok": True}


# Tavus calls this as its OpenAI-compatible LLM endpoint — rate limited to 120/min
@app.post("/v1/chat/completions")
@limiter.limit("120/minute")
async def chat_completions(request: Request):
    return await handle_chat_completions(request)


@app.post("/chat/completions")
@limiter.limit("120/minute")
async def chat_completions_alt(request: Request):
    return await handle_chat_completions(request)

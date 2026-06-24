"""Tavus API client — persona creation + conversation management."""
from __future__ import annotations

import aiohttp
from loguru import logger

from .config import config

TAVUS_BASE = "https://tavusapi.com"

_HEADERS = lambda: {  # noqa: E731
    "x-api-key": config.tavus_api_key,
    "Content-Type": "application/json",
}


async def ensure_persona() -> str:
    """Return TAVUS_PERSONA_ID from env, or create one and return it.

    The persona is created once (points Tavus's LLM layer at our backend).
    Store the returned ID as TAVUS_PERSONA_ID in .env to avoid re-creating
    on each restart.
    """
    if config.tavus_persona_id:
        return config.tavus_persona_id

    logger.info("[tavus] creating persona (TAVUS_PERSONA_ID not set)")

    llm_layer: dict = {
        "model": "custom",
        "base_url": f"{config.public_backend_url}/v1",
        "api_key": config.llm_internal_key,
    }

    # Cartesia TTS with custom voice + Tavus-advanced STT (Deepgram-powered)
    layers: dict = {
        "llm": llm_layer,
        "tts": {
            "tts_engine": "cartesia",
            "external_voice_id": config.cartesia_voice_id,
            "api_key": config.cartesia_api_key,
            "tts_emotion_control": True,
            "tts_model_name": "sonic-3",
        },
        "stt": {
            "stt_engine": "tavus-advanced",   # Deepgram-powered, managed by Tavus
            "hotwords": "Mykare appointment doctor",
        },
    }

    payload = {
        "persona_name": "Mykare AI Receptionist",
        "system_prompt": (
            "You are Aria, the AI receptionist at Mykare Health. "
            "Your LLM is handled by an external service — just relay naturally."
        ),
        "pipeline_mode": "full",
        "default_replica_id": config.tavus_replica_id,
        "layers": layers,
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{TAVUS_BASE}/v2/personas",
            json=payload,
            headers=_HEADERS(),
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            raw = await resp.text()
            logger.debug(f"[tavus] persona response {resp.status}: {raw[:500]}")
            try:
                data = await resp.json(content_type=None)
            except Exception:
                raise RuntimeError(f"Tavus persona creation HTTP {resp.status}: {raw[:300]}")

    if "persona_id" not in data:
        raise RuntimeError(f"Tavus persona creation failed: {data}")

    persona_id = data["persona_id"]
    logger.info(f"[tavus] persona created: {persona_id} — set TAVUS_PERSONA_ID={persona_id} in .env")
    return persona_id


async def create_conversation(persona_id: str, session_id: str) -> dict:
    """Create a Tavus CVI conversation. Returns conversation_id + conversation_url."""
    payload = {
        "persona_id": persona_id,
        "conversation_name": f"Mykare Call {session_id[:8]}",
        "custom_greeting": (
            "Hello! I'm Aria from Mykare Health. How can I help you today?"
        ),
        # Embed session_id so our LLM endpoint can correlate tool events
        "conversational_context": f"[MYKARE_SESSION:{session_id}]",
        "callback_url": f"{config.public_backend_url}/api/callback/conversation",
        "properties": {
            "max_call_duration": 600,
            "participant_left_timeout": 20,
            "enable_recording": False,
        },
    }

    async with aiohttp.ClientSession() as session_http:
        async with session_http.post(
            f"{TAVUS_BASE}/v2/conversations",
            json=payload,
            headers=_HEADERS(),
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            data = await resp.json()

    if "conversation_id" not in data:
        raise RuntimeError(f"Tavus conversation creation failed: {data}")

    logger.info(f"[tavus] conversation created: {data['conversation_id']}")
    return {
        "conversation_id": data["conversation_id"],
        "conversation_url": data["conversation_url"],
        "status": data.get("status", "active"),
    }


async def end_conversation(conversation_id: str) -> None:
    """End a Tavus conversation (call it when end_conversation tool fires)."""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{TAVUS_BASE}/v2/conversations/{conversation_id}/end",
            headers=_HEADERS(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status not in (200, 204):
                logger.warning(f"[tavus] end_conversation returned {resp.status}")

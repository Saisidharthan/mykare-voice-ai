"""In-memory SSE event bus — one asyncio.Queue per session + admin broadcast."""
import asyncio
import time
from typing import Any

_sessions: dict[str, tuple[asyncio.Queue, float]] = {}
_TTL = 1800  # 30 min

# Admin broadcast: list of queues, one per connected admin SSE client
_admin_listeners: list[asyncio.Queue] = []


# ---------- per-session (tool events / transcript) ----------

def register(session_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _sessions[session_id] = (q, time.monotonic())
    _cleanup()
    return q


def get_queue(session_id: str) -> asyncio.Queue | None:
    entry = _sessions.get(session_id)
    return entry[0] if entry else None


async def emit(session_id: str, event: dict[str, Any]) -> None:
    q = get_queue(session_id)
    if q:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def close(session_id: str) -> None:
    q = get_queue(session_id)
    if q:
        await q.put({"type": "close"})
    _sessions.pop(session_id, None)


def _cleanup() -> None:
    now = time.monotonic()
    stale = [sid for sid, (_, ts) in _sessions.items() if now - ts > _TTL]
    for sid in stale:
        _sessions.pop(sid, None)


# ---------- admin broadcast (DB changes → Appointments page) ----------

def subscribe_admin() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _admin_listeners.append(q)
    return q


def unsubscribe_admin(q: asyncio.Queue) -> None:
    try:
        _admin_listeners.remove(q)
    except ValueError:
        pass


async def broadcast_admin(event: dict[str, Any]) -> None:
    dead = []
    for q in _admin_listeners:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        unsubscribe_admin(q)

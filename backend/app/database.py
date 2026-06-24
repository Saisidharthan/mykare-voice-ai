"""SQLite async DB — users + appointments with double-booking prevention."""
import aiosqlite
import json
from datetime import date as _date
from loguru import logger

from .config import config

DB_PATH = config.db_path

# Available clinic slots — morning (9–11) and afternoon (14–17), hourly
# Skips 12:00–13:00 (lunch break). Easy to extend by adding more times.
SLOT_TIMES = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"]


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                phone       TEXT    UNIQUE NOT NULL,
                name        TEXT,
                created_at  TEXT    DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS appointments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                name        TEXT,
                date        TEXT NOT NULL,
                time_slot   TEXT NOT NULL,
                intent      TEXT,
                status      TEXT NOT NULL DEFAULT 'confirmed',
                created_at  TEXT    DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot
                ON appointments(date, time_slot)
                WHERE status = 'confirmed';

            CREATE TABLE IF NOT EXISTS call_sessions (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id      TEXT    UNIQUE NOT NULL,
                conversation_id TEXT,
                summary         TEXT,
                created_at      TEXT    DEFAULT CURRENT_TIMESTAMP,
                ended_at        TEXT
            );
        """)
        await db.commit()
    logger.info(f"[db] initialised at {DB_PATH}")


# ---------- session persistence ----------

async def save_session(session_id: str, conversation_id: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO call_sessions (session_id, conversation_id) VALUES (?, ?)",
            (session_id, conversation_id),
        )
        await db.commit()


async def save_summary(session_id: str, summary: dict) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE call_sessions
               SET summary = ?, ended_at = CURRENT_TIMESTAMP
               WHERE session_id = ?""",
            (json.dumps(summary), session_id),
        )
        await db.commit()


async def get_all_sessions(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM call_sessions ORDER BY created_at DESC LIMIT ?", (limit,)
        ) as cur:
            rows = await cur.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("summary"):
            try:
                d["summary"] = json.loads(d["summary"])
            except Exception:
                pass
        result.append(d)
    return result


# ---------- user helpers ----------

async def get_or_create_user(phone: str, name: str | None = None) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE phone = ?", (phone,)) as cur:
            row = await cur.fetchone()
        if row:
            if name and not row["name"]:
                await db.execute("UPDATE users SET name = ? WHERE phone = ?", (name, phone))
                await db.commit()
            return dict(row)
        await db.execute("INSERT INTO users (phone, name) VALUES (?, ?)", (phone, name))
        await db.commit()
        async with db.execute("SELECT * FROM users WHERE phone = ?", (phone,)) as cur:
            row = await cur.fetchone()
        return dict(row)


# ---------- slot helpers ----------

async def fetch_slots(date: str) -> list[str]:
    """Return slots not already booked on `date` (YYYY-MM-DD)."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT time_slot FROM appointments WHERE date = ? AND status = 'confirmed'",
            (date,),
        ) as cur:
            booked = {row[0] async for row in cur}
    return [s for s in SLOT_TIMES if s not in booked]


# ---------- appointment CRUD ----------

async def book_appointment(user_id: int, name: str, date: str, time_slot: str, intent: str = "") -> dict:
    # Reject past dates
    try:
        appt_date = _date.fromisoformat(date)
    except ValueError:
        raise ValueError(f"Invalid date format: {date}. Use YYYY-MM-DD.")
    if appt_date < _date.today():
        raise ValueError(f"{date} is in the past. Please choose a future date.")

    # Prevent same patient booking twice on the same day
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, time_slot FROM appointments WHERE user_id=? AND date=? AND status='confirmed'",
            (user_id, date),
        ) as cur:
            existing = await cur.fetchone()
        if existing:
            raise ValueError(
                f"You already have an appointment at {existing['time_slot']} on {date}. "
                "Would you like to reschedule it instead?"
            )
        try:
            await db.execute(
                "INSERT INTO appointments (user_id, name, date, time_slot, intent) VALUES (?,?,?,?,?)",
                (user_id, name, date, time_slot, intent),
            )
            await db.commit()
        except aiosqlite.IntegrityError:
            raise ValueError(f"Slot {time_slot} on {date} is already booked.")
        async with db.execute(
            "SELECT * FROM appointments WHERE user_id=? AND date=? AND time_slot=? AND status='confirmed'",
            (user_id, date, time_slot),
        ) as cur:
            row = await cur.fetchone()
        return dict(row)


async def get_appointments(user_id: int) -> list[dict]:
    """Return only confirmed, non-past appointments so the LLM sees clean IDs to act on."""
    today = _date.today().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM appointments WHERE user_id=? AND status='confirmed' AND date >= ? ORDER BY date, time_slot",
            (user_id, today),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def cancel_appointment(appointment_id: int, user_id: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM appointments WHERE id=? AND user_id=?",
            (appointment_id, user_id),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise ValueError(f"Appointment {appointment_id} not found for this user.")
        if row["status"] == "cancelled":
            raise ValueError(f"Appointment {appointment_id} is already cancelled.")
        await db.execute(
            "UPDATE appointments SET status='cancelled' WHERE id=?", (appointment_id,)
        )
        await db.commit()
        async with db.execute("SELECT * FROM appointments WHERE id=?", (appointment_id,)) as cur:
            updated = await cur.fetchone()
    return dict(updated)


async def modify_appointment(appointment_id: int, user_id: int, new_date: str, new_time: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM appointments WHERE id=? AND user_id=? AND status='confirmed'",
            (appointment_id, user_id),
        ) as cur:
            row = await cur.fetchone()
        if not row:
            raise ValueError(f"Appointment {appointment_id} not found or already cancelled.")
        # Check the new slot is free
        async with db.execute(
            "SELECT id FROM appointments WHERE date=? AND time_slot=? AND status='confirmed' AND id!=?",
            (new_date, new_time, appointment_id),
        ) as cur:
            conflict = await cur.fetchone()
        if conflict:
            raise ValueError(f"Slot {new_time} on {new_date} is already taken.")
        await db.execute(
            "UPDATE appointments SET date=?, time_slot=? WHERE id=?",
            (new_date, new_time, appointment_id),
        )
        await db.commit()
        async with db.execute("SELECT * FROM appointments WHERE id=?", (appointment_id,)) as cur:
            updated = await cur.fetchone()
    return dict(updated)

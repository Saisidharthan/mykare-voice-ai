"""Execute the 7 Mykare appointment tools and emit SSE events."""
import json
import re
from typing import Any

from loguru import logger

from . import database as db
from . import events


# UI labels shown in the frontend tool-status panel
TOOL_LABELS = {
    "identify_user":        ("Identifying patient...",       "Patient identified ✅"),
    "fetch_slots":          ("Fetching available slots...",  "Slots fetched ✅"),
    "book_appointment":     ("Booking appointment...",       "Appointment booked ✅"),
    "retrieve_appointments":("Retrieving appointments...",   "Appointments loaded ✅"),
    "cancel_appointment":   ("Cancelling appointment...",    "Appointment cancelled ✅"),
    "modify_appointment":   ("Rescheduling appointment...",  "Appointment updated ✅"),
    "end_conversation":     ("Ending conversation...",       "Conversation ended ✅"),
}


async def execute(name: str, args: dict[str, Any], session_id: str) -> str:
    """Execute `name` tool with `args`, emit SSE events, return JSON string result."""
    start_label, done_label = TOOL_LABELS.get(name, (f"Calling {name}...", f"{name} done ✅"))

    await events.emit(session_id, {"type": "tool_start", "tool": name, "label": start_label})
    logger.info(f"[tools] {name} args={args} session={session_id}")

    try:
        result = await _run(name, args, session_id)
    except Exception as exc:
        error_payload = {"error": str(exc)}
        await events.emit(session_id, {"type": "tool_error", "tool": name, "label": f"Error: {exc}"})
        return json.dumps(error_payload)

    await events.emit(session_id, {"type": "tool_done", "tool": name, "label": done_label, "result": result})
    return json.dumps(result)


async def _run(name: str, args: dict[str, Any], session_id: str) -> Any:
    if name == "identify_user":
        raw_phone = re.sub(r"\D", "", args["phone_number"])
        if len(raw_phone) < 10:
            return {"error": f"Phone number too short ({len(raw_phone)} digits). Ask the patient to repeat their full 10-digit number."}
        user = await db.get_or_create_user(
            phone=raw_phone,
            name=args.get("name"),
        )
        # Store session state so LLM never re-identifies on future turns (deferred import avoids circular)
        from .llm import update_session_state
        update_session_state(
            session_id,
            user_id=user["id"],
            name=user["name"] or args.get("name") or "",
            phone=user["phone"],
        )
        return {
            "user_id": user["id"],
            "name": user["name"],
            "phone": user["phone"],
            "is_new": not bool(user.get("name")),
        }

    elif name == "fetch_slots":
        available = await db.fetch_slots(args["date"])
        return {"date": args["date"], "available_slots": available}

    elif name == "book_appointment":
        # Use the registered name from session state, not the STT-interpreted name
        from .llm import _session_state
        registered_name = _session_state.get(session_id, {}).get("name") or args.get("name", "")
        appt = await db.book_appointment(
            user_id=args["user_id"],
            name=registered_name,
            date=args["date"],
            time_slot=args["time_slot"],
            intent=args.get("intent", ""),
        )
        await events.broadcast_admin({"type": "db_update", "action": "booked", "date": appt["date"], "time": appt["time_slot"]})
        return {
            "appointment_id": appt["id"],
            "date": appt["date"],
            "time_slot": appt["time_slot"],
            "name": appt["name"],
            "status": appt["status"],
        }

    elif name == "retrieve_appointments":
        appts = await db.get_appointments(args["user_id"])
        # Rename 'id' → 'appointment_id' so LLM never confuses DB row ID with list position
        formatted = [
            {
                "appointment_id": a["id"],   # USE THIS exact number in cancel/modify calls
                "date": a["date"],
                "time_slot": a["time_slot"],
                "intent": a["intent"],
                "status": a["status"],
            }
            for a in appts
        ]
        return {"appointments": formatted, "total": len(formatted)}

    elif name == "cancel_appointment":
        appt = await db.cancel_appointment(
            appointment_id=args["appointment_id"],
            user_id=args["user_id"],
        )
        await events.broadcast_admin({"type": "db_update", "action": "cancelled"})
        return {"appointment_id": appt["id"], "status": appt["status"]}

    elif name == "modify_appointment":
        appt = await db.modify_appointment(
            appointment_id=args["appointment_id"],
            user_id=args["user_id"],
            new_date=args["new_date"],
            new_time=args["new_time"],
        )
        await events.broadcast_admin({"type": "db_update", "action": "modified", "date": appt["date"], "time": appt["time_slot"]})
        return {
            "appointment_id": appt["id"],
            "new_date": appt["date"],
            "new_time": appt["time_slot"],
            "status": appt["status"],
        }

    elif name == "end_conversation":
        # Signal will be handled by the LLM layer (summary generation + SSE close)
        return {"status": "ending", "reason": args.get("reason", "")}

    else:
        raise ValueError(f"Unknown tool: {name}")

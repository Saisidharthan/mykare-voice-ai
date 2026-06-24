"""Typed config — adapted from Artic's Config pattern (frozen pydantic + from_env)."""
import os
import sys

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict

load_dotenv()


def _str(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    return default if not raw else raw in ("1", "true", "yes", "on")


class Config(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    openai_api_key: str
    openai_model: str

    tavus_api_key: str
    tavus_replica_id: str
    tavus_persona_id: str

    deepgram_api_key: str
    cartesia_api_key: str
    cartesia_voice_id: str

    public_backend_url: str
    llm_internal_key: str

    db_path: str

    @classmethod
    def from_env(cls) -> "Config":
        errors: list[str] = []
        required = {
            "OPENAI_API_KEY": _str("OPENAI_API_KEY"),
            "TAVUS_API_KEY": _str("TAVUS_API_KEY"),
            "TAVUS_REPLICA_ID": _str("TAVUS_REPLICA_ID"),
            "PUBLIC_BACKEND_URL": _str("PUBLIC_BACKEND_URL"),
            "LLM_INTERNAL_KEY": _str("LLM_INTERNAL_KEY", "change-me-secret-key"),
        }
        for key, val in required.items():
            if not val:
                errors.append(f"  - {key} is required")
        if errors:
            print("ERROR: missing required config:\n" + "\n".join(errors), file=sys.stderr)
            sys.exit(1)
        return cls(
            openai_api_key=_str("OPENAI_API_KEY"),
            openai_model=_str("OPENAI_MODEL", "gpt-4o-mini"),
            tavus_api_key=_str("TAVUS_API_KEY"),
            tavus_replica_id=_str("TAVUS_REPLICA_ID"),
            tavus_persona_id=_str("TAVUS_PERSONA_ID"),
            deepgram_api_key=_str("DEEPGRAM_API_KEY"),
            cartesia_api_key=_str("CARTESIA_API_KEY"),
            cartesia_voice_id=_str("CARTESIA_VOICE_ID", "a0e99841-438c-4a64-b679-ae501e7d6091"),
            public_backend_url=_str("PUBLIC_BACKEND_URL").rstrip("/"),
            llm_internal_key=_str("LLM_INTERNAL_KEY", "change-me-secret-key"),
            db_path=_str("DB_PATH", "./mykare.db"),
        )


config = Config.from_env()

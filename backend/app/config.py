"""Runtime settings, read from environment / .env once at import time."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# The desktop launcher points SOTP_DATA_DIR at %LOCALAPPDATA%\SOTP Dev Env; a dev checkout uses backend/.env
_DATA_DIR = Path(os.getenv("SOTP_DATA_DIR") or Path(__file__).resolve().parents[1])
try:  # optional dependency
    from dotenv import load_dotenv
    load_dotenv(_DATA_DIR / ".env")
except ImportError:  # pragma: no cover
    pass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./sotp_devenv.db")
    default_mod_root: str | None = os.getenv("SOTP_MOD_ROOT") or None
    default_vanilla_root: str | None = os.getenv("SINS_VANILLA_ROOT") or None
    cors_origins: tuple[str, ...] = tuple(o for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o)
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = int(os.getenv("PORT", "8000"))
    data_dir: Path = _DATA_DIR
    ui_dir: str | None = os.getenv("SOTP_UI_DIR") or None   # built frontend to serve at "/" (desktop build)
    update_repo: str = os.getenv("SOTP_UPDATE_REPO", "Billistic/SOTP-Dev-Toolset")   # GitHub owner/repo publishing releases
    allow_unsigned_updates: bool = os.getenv("SOTP_UPDATE_ALLOW_UNSIGNED", "0") == "1"


settings = Settings()

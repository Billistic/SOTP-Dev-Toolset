"""MCP endpoint state: the on/off switch (persisted in the data dir) and an in-memory log of recent tool calls.

Off by default: the endpoint answers 404 until the user enables it under Project settings.
"""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from ..config import settings

SETTINGS_FILE: Path = settings.data_dir / "mcp_settings.json"
DEFAULTS: dict[str, Any] = {"enabled": False}

_lock = threading.Lock()
_calls: deque[dict[str, Any]] = deque(maxlen=50)
_last_seen: dict[str, Any] = {"at": None, "client": None, "named": False}


def load() -> dict[str, Any]:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    return {**DEFAULTS, **{k: v for k, v in data.items() if k in DEFAULTS}}


def save(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        data = {**load(), **{k: v for k, v in patch.items() if k in DEFAULTS}}
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def enabled() -> bool:
    return bool(load()["enabled"])


def touch(client: str | None = None, named: bool = False) -> None:
    """Any request that reached the endpoint while enabled. ``named``: the client named itself in the protocol;
    a bare User-Agent never replaces such a name."""
    with _lock:
        _last_seen["at"] = time.time()
        if client and (named or not _last_seen["named"]):
            _last_seen["client"], _last_seen["named"] = client, named


def record_call(tool: str, args: dict[str, Any], ok: bool, ms: float, error: str | None = None) -> None:
    with _lock:
        _calls.appendleft({"at": time.time(), "tool": tool, "args": args, "ok": ok, "ms": round(ms, 1), "error": error})


def activity() -> dict[str, Any]:
    with _lock:
        return {"lastSeenAt": _last_seen["at"], "lastClient": _last_seen["client"], "calls": list(_calls)}


def clear_log() -> None:
    with _lock:
        _calls.clear()

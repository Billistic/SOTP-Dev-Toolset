"""Settings / status for the MCP endpoint (the endpoint itself is app/mcp_server.py)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from .. import mcp_server
from ..services import mcp_settings

router = APIRouter(prefix="/mcp", tags=["mcp"])


class McpSettingsIn(BaseModel):
    enabled: bool


def _status(request: Request) -> dict:
    # the socket the backend really listens on, not the Host header (the Vite dev proxy rewrites that)
    host, port = (request.scope.get("server") or ("127.0.0.1", 8000))[:2]
    host = "127.0.0.1" if host in ("0.0.0.0", "::", "localhost") else host
    return {**mcp_settings.load(), "url": f"http://{host}:{port}{mcp_server.PATH}", "readOnly": True,
            "tools": mcp_server.tool_list(), **mcp_settings.activity()}


@router.get("")
def mcp_status(request: Request):
    return _status(request)


@router.put("")
def update_mcp(body: McpSettingsIn, request: Request):
    mcp_settings.save(body.model_dump())
    return _status(request)


@router.delete("/log", status_code=204)
def clear_mcp_log():
    mcp_settings.clear_log()

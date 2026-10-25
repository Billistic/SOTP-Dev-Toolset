"""Read-only MCP (Model Context Protocol) endpoint at ``/mcp``.

Any MCP client that speaks Streamable HTTP (Claude Desktop / Code, Cursor, VS Code, Windsurf, ...) can query the
active project through the same services the UI uses. Nothing here writes: no edits, no exports, no ingest.
The endpoint is off until the user enables it (services/mcp_settings.py) and only answers on loopback hosts.
"""
from __future__ import annotations

import functools
import inspect
import json
import time
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.types import Receive, Scope, Send

from .dao import DiagnosticDAO, EntityDAO, ProjectDAO
from .db import active_project_id, project_session
from .models import Project
from .services import mcp_settings
from .sins import Document
from .services.analytics_service import METRICS, AnalyticsService
from .services.balance_service import BalanceService
from .services.edit_service import EditService
from .version import __version__

PATH = "/mcp"
READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

server = MCPServer(
    name="sotp-dev-env",
    title="SOTP Dev Env",
    version=__version__,
    instructions=(
        "Read-only access to a Sins of a Solar Empire: Rebellion mod indexed by SOTP Dev Env (the active project). "
        "Start with project_overview, find entities with search_entities, then drill in with get_entity, "
        "entity_references and list_diagnostics. metric_table and balance_recommendations give the unbuffed "
        "numbers the Analytics and Balance views show. Entity names are file names without the extension."
    ),
)


@contextmanager
def _project() -> Iterator[tuple[Session, Project]]:
    pid = active_project_id()
    if pid is None:
        raise ToolError("No active project: open or create one in SOTP Dev Env first.")
    db = project_session(pid)
    try:
        project = ProjectDAO(db).active()
        if project is None:
            raise ToolError("No active project: open or create one in SOTP Dev Env first.")
        yield db, project
    finally:
        db.close()


def _entity(db: Session, project: Project, name: str):
    entity = EntityDAO(db).by_name(project.id, name)
    if entity is None:
        raise ToolError(f"entity '{name}' not found (use search_entities to find the exact name)")
    return entity


def _logged(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Record each call for the activity list under Project settings, and answer compact JSON text (the SDK's
    default is indent=2, a third more tokens for the client's model)."""
    defaults = {k: p.default for k, p in inspect.signature(fn).parameters.items()}

    @functools.wraps(fn)
    def wrapper(**kwargs: Any) -> Any:
        given = {k: v for k, v in kwargs.items() if v != defaults.get(k, inspect.Parameter.empty)}
        start = time.perf_counter()
        try:
            out = fn(**kwargs)
        except Exception as exc:
            mcp_settings.record_call(fn.__name__, given, False, (time.perf_counter() - start) * 1000, str(exc))
            raise
        mcp_settings.record_call(fn.__name__, given, True, (time.perf_counter() - start) * 1000)
        return json.dumps(out, separators=(",", ":"), default=str)
    return wrapper


def tool(fn: Callable[..., Any]) -> Callable[..., Any]:
    return server.tool(annotations=READ_ONLY, structured_output=False)(_logged(fn))


@tool
def project_overview() -> dict[str, Any]:
    """The active project: mod / base-game roots, entity counts per type, headline analytics and a diagnostics
    summary. Call this first to learn what the mod contains."""
    with _project() as (db, project):
        return {
            "project": {"name": project.name, "modRoot": project.mod_root, "vanillaRoot": project.vanilla_root},
            "entityTypes": EntityDAO(db).type_counts(project.id),
            "overview": AnalyticsService(db).overview(project),
            "diagnostics": DiagnosticDAO(db).summary(project.id),
            "metricCategories": METRICS,
        }


@tool
def search_entities(search: str | None = None, entity_type: str | None = None, category: str | None = None,
                    faction: str | None = None, race: str | None = None, errors_only: bool = False,
                    limit: int = 50, offset: int = 0) -> dict[str, Any]:
    """Find entities by name / display-name text and filters. entity_type is the Sins type (e.g. Frigate,
    CapitalShip, Ability, Buff, ResearchSubject); category is the tool's grouping (ship, module, research, ...).
    Returns summaries (name, type, faction, error / warning counts); page with limit / offset (limit max 500)."""
    limit = max(1, min(limit, 500))
    with _project() as (db, project):
        rows = EntityDAO(db).list(project.id, entity_type=entity_type, category=category, faction=faction, race=race,
                                  search=search, with_errors=errors_only, limit=limit + 1, offset=offset)
        return {"entities": [e.summary() for e in rows[:limit]], "hasMore": len(rows) > limit}


@tool
def get_entity(name: str, include_text: bool = False, include_tree: bool = False) -> dict[str, Any]:
    """One entity in detail: summary, typed stats, weapons, research prerequisites, modifiers and its diagnostics.
    include_text adds the file as the game reads it; include_tree adds the parsed key/value tree (large)."""
    with _project() as (db, project):
        entity = _entity(db, project, name)
        out: dict[str, Any] = {
            **entity.summary(),
            "typed": entity.typed_json,
            "weapons": [w.to_dict() for w in entity.weapons],
            "prerequisites": [{"subject": p.subject, "level": p.level} for p in entity.prerequisites],
            "modifiers": [{"type": m.modifier_type, "base": m.base_value, "perLevel": m.per_level_value,
                           "isBool": m.is_bool} for m in entity.modifiers],
            "diagnostics": [d.to_dict() for d in DiagnosticDAO(db).list(project.id, entity_id=entity.id)],
        }
        if include_text:
            out["text"] = EditService(db).render(entity, "preserve")
        if include_tree:
            out["tree"] = Document.from_json(entity.tree_json).to_json()
        return out


@tool
def entity_references(name: str, direction: str = "both") -> dict[str, Any]:
    """What an entity points at ("out": abilities, weapons, research, strings, meshes, ...) and what points at it
    ("in"). direction is "out", "in" or "both". Unresolved targets show up as broken references."""
    if direction not in ("out", "in", "both"):
        raise ToolError('direction must be "out", "in" or "both"')
    with _project() as (db, project):
        entity = _entity(db, project, name)
        dao = EntityDAO(db)
        out: dict[str, Any] = {"name": entity.name}
        if direction in ("out", "both"):
            out["references"] = [r.to_dict() for r in dao.references_out(entity.id)]
        if direction in ("in", "both"):
            out["referencedBy"] = [{"source": e.name, "entityType": e.entity_type, "path": r.path, "key": r.key}
                                   for r, e in dao.references_in(project.id, entity.name)]
        return out


@tool
def list_diagnostics(severity: str | None = None, code: str | None = None, entity: str | None = None,
                     search: str | None = None, limit: int = 50, offset: int = 0) -> dict[str, Any]:
    """Validation findings (broken references, missing / unknown fields, invalid enum values).
    severity is "error", "warning" or "info"; code filters one diagnostic code (e.g. MISSING_REFERENCE);
    entity limits to one entity. Missing references only count as errors when a base-game root is indexed."""
    limit = max(1, min(limit, 1000))
    with _project() as (db, project):
        dao = DiagnosticDAO(db)
        entity_id = _entity(db, project, entity).id if entity else None
        rows = dao.list(project.id, severity=severity, code=code, entity_id=entity_id, search=search,
                        limit=limit + 1, offset=offset)
        return {"summary": dao.summary(project.id), "diagnostics": [d.to_dict() for d in rows[:limit]],
                "hasMore": len(rows) > limit}


@tool
def metric_table(category: str = "ship", entity_type: str | None = None, faction: str | None = None,
                 metrics: list[str] | None = None, names: list[str] | None = None, sort_by: str | None = None,
                 descending: bool = True, limit: int = 40, offset: int = 0,
                 faction_summary: bool = False) -> dict[str, Any]:
    """Unbuffed stat table per entity for a category ("ship", "module", "research" or "squad"), the same numbers
    as the Analytics view: costs, hull / shield / armor, EHP, DPS, range, speed and per-cost ratios (the metric
    names per category are in project_overview.metricCategories). Narrow it: entity_type (e.g. Frigate), faction,
    names (exact entity names), metrics (columns to keep), sort_by a metric; page with limit / offset (max 200).
    faction_summary adds per-faction summaries for the category / entity_type (large)."""
    if category not in METRICS:
        raise ToolError(f"category must be one of {sorted(METRICS)}")
    unknown = [m for m in (metrics or []) + ([sort_by] if sort_by else []) if m not in METRICS[category]]
    if unknown:
        raise ToolError(f"unknown metric(s) {unknown}; {category} metrics are {METRICS[category]}")
    limit = max(1, min(limit, 200))
    with _project() as (db, project):
        table = AnalyticsService(db).metric_table(project, category, entity_type)
    rows = table["rows"]
    if faction:
        rows = [r for r in rows if (r.get("faction") or "").lower() == faction.lower()]
    if names:
        wanted = set(names)
        rows = [r for r in rows if r["name"] in wanted]
    if sort_by:
        known = [r for r in rows if r.get(sort_by) is not None]
        rows = sorted(known, key=lambda r: r[sort_by], reverse=descending) + [r for r in rows if r.get(sort_by) is None]
    keep = metrics or table["metrics"]
    ident = ("name", "displayName", "entityType", "race", "faction", "role")
    page = [{**{k: r.get(k) for k in ident}, **{m: r.get(m) for m in keep}} for r in rows[offset:offset + limit]]
    out = {"metrics": keep, "total": len(rows), "rows": page, "hasMore": offset + limit < len(rows)}
    if faction_summary:
        out["byFaction"] = table.get("byFaction")
    return out


@tool
def balance_recommendations(category: str = "ship", z: float = 1.5, min_group: int = 3,
                            entity_type: str | None = None, reachable_only: bool = True) -> Any:
    """Statistical outliers against comparable peers (same role / type / faction grouping), as the Balance view
    shows them: z is the z-score threshold (>= 0.5), min_group the smallest peer group compared, reachable_only
    skips entities no player can build. Excluded entities (Balance view exclusions) are left out."""
    with _project() as (db, project):
        return BalanceService(db).recommendations(project, category=category, z_threshold=max(z, 0.5),
                                                  min_group=min_group, entity_type=entity_type,
                                                  reachable_only=reachable_only)


# ── HTTP plumbing ───────────────────────────────────────────────────────
_endpoint: Any = None


@asynccontextmanager
async def running() -> AsyncIterator[None]:
    """Run the transport for one app lifespan. The SDK's session manager is single-use, so each lifespan (one per
    TestClient in tests) builds a fresh one."""
    global _endpoint
    http_app = server.streamable_http_app(streamable_http_path=PATH, stateless_http=True, json_response=True)
    endpoint = next(r.app for r in http_app.routes if getattr(r, "path", None) == PATH)
    async with server.session_manager.run():
        _endpoint = endpoint
        try:
            yield
        finally:
            _endpoint = None


class _Gated:
    """ASGI endpoint: 404 while disabled; otherwise note the client (from ``initialize``) and hand over to the
    SDK transport."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not mcp_settings.enabled():
            await JSONResponse({"detail": "MCP endpoint is disabled. Enable it under Project settings."},
                               status_code=404)(scope, receive, send)
            return
        if _endpoint is None:
            await JSONResponse({"detail": "MCP transport is not running."}, status_code=503)(scope, receive, send)
            return
        messages: list[dict[str, Any]] = []
        body = b""
        while True:   # buffer the body so we can peek at it, then replay it to the transport
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        client = None
        if scope.get("method") == "POST" and body[:1] == b"{":
            try:
                payload = json.loads(body)
                if payload.get("method") == "initialize":
                    info = payload.get("params", {}).get("clientInfo") or {}
                    client = " ".join(str(info[k]) for k in ("name", "version") if info.get(k)) or None
            except ValueError:
                pass
        mcp_settings.touch(client)

        async def replay() -> dict[str, Any]:
            return messages.pop(0) if messages else await receive()

        await _endpoint(scope, replay, send)


route = Route(PATH, endpoint=_Gated(), methods=["GET", "POST", "DELETE"])


def tool_list() -> list[dict[str, str]]:
    """Name + first sentence of each tool, for the Settings card."""
    return [{"name": t.name, "description": " ".join((t.description or "").split()).split(". ")[0].rstrip(".") + "."}
            for t in server._tool_manager.list_tools()]

"""Analytics, balance recommendations, graphs and exports."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..dao import LayoutDAO
from ..db import get_db
from ..models import Project
from ..services.analytics_service import METRICS, AnalyticsService
from ..services.balance_service import BalanceService
from ..services.buff_service import BuffService
from ..services.export_service import ExportService
from ..services.manifest_service import ManifestService
from ..services.graph_service import GraphService
from .deps import get_project

router = APIRouter(tags=["insights"])


# ── analytics ───────────────────────────────────────────────────────────
@router.get("/analytics/overview")
def overview(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AnalyticsService(db).overview(project)


@router.get("/analytics/fields/{entity_type}")
def field_catalog(entity_type: str, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AnalyticsService(db).field_catalog(project, entity_type)


@router.get("/analytics/distribution")
def distribution(entity_type: str, path: str, group_by: str = "faction",
                 db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AnalyticsService(db).distribution(project, entity_type, path, group_by)


@router.get("/analytics/metrics")
def metric_catalog():
    return METRICS


@router.get("/analytics/metrics/{category}")
def metric_table(category: str, entity_type: str | None = None, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AnalyticsService(db).metric_table(project, category, entity_type)


@router.get("/analytics/weapons")
def weapon_summary(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AnalyticsService(db).weapon_summary(project)


@router.get("/analytics/research")
def research_summary(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AnalyticsService(db).research_summary(project)


# ── balance ─────────────────────────────────────────────────────────────
@router.get("/balance/recommendations")
def recommendations(category: str = "ship", z: float = Query(1.5, ge=0.5), min_group: int = 3,
                    entity_type: str | None = None, reachable_only: bool = True,
                    db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return BalanceService(db).recommendations(project, category=category, z_threshold=z, min_group=min_group,
                                              entity_type=entity_type, reachable_only=reachable_only)


@router.get("/balance/symmetry")
def symmetry(category: str = "ship", reachable_only: bool = True, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return BalanceService(db).faction_symmetry(project, category, reachable_only)


# ── graphs ──────────────────────────────────────────────────────────────
@router.get("/graph/research/{player}")
def research_graph(player: str, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return GraphService(db).research_tree(project, player)


@router.get("/graph/relationships")
def relationships(categories: str | None = None, focus: str | None = None, depth: int = Query(2, ge=1, le=5),
                  direction: str = Query("out", pattern="^(out|in|both)$"), incoming: bool = False, include: str | None = None,
                  factions: str | None = None, asset_kinds: str | None = None, asset_focus: str | None = None,
                  max_nodes: int = Query(600, le=2000), db: Session = Depends(get_db), project: Project = Depends(get_project)):
    split = lambda s: {x.strip() for x in s.split(",") if x.strip()} if s else None  # noqa: E731
    return GraphService(db).relationships(project, categories=split(categories), focus=focus or None, depth=depth,
                                          direction=direction, incoming=incoming, include=split(include), factions=split(factions),
                                          asset_kinds=split(asset_kinds), asset_focus=asset_focus or None, max_nodes=max_nodes)


class LayoutIn(BaseModel):
    positions: dict[str, dict[str, float]]
    merge: bool = True


@router.get("/graph/layout/{view_key}")
def get_layout(view_key: str, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    row = LayoutDAO(db).get(project.id, view_key)
    return row.to_dict() if row else {"viewKey": view_key, "positions": {}, "updatedAt": None}


@router.put("/graph/layout/{view_key}")
def put_layout(view_key: str, body: LayoutIn, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    row = LayoutDAO(db).save(project.id, view_key, body.positions, merge=body.merge)
    db.commit()
    return row.to_dict()


@router.delete("/graph/layout/{view_key}", status_code=204)
def delete_layout(view_key: str, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    LayoutDAO(db).clear(project.id, view_key)
    db.commit()


@router.get("/graph/neighbourhood/{name}")
def neighbourhood(name: str, depth: int = Query(1, ge=1, le=3), db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return GraphService(db).neighbourhood(project, name, depth)


@router.get("/analytics/buffs")
def buff_summary(category: str = "ship", level: int = 0, hull: float = 1.0, db: Session = Depends(get_db),
                 project: Project = Depends(get_project)):
    """Every unit whose own abilities change its numbers: base vs buffed headline metrics."""
    return BuffService(db).summary(project, category, level=level, hull=max(0.0, min(hull, 1.0)))


# ── export ──────────────────────────────────────────────────────────────
@router.post("/export/write-dirty")
def write_dirty(mode: str = "preserve", db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return {"written": ExportService(db).write_dirty(project, mode)}


@router.post("/export/manifest")
def write_manifest(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    """Reconcile entity.manifest with the tool's writes / deletes; never touches hand-made entries."""
    return ExportService(db).write_manifest(project)


@router.get("/export/manifest")
def manifest_status(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return ManifestService(db).status(project)


@router.get("/export/csv/{entity_type}")
def export_csv(entity_type: str, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return _csv_download(ExportService(db).csv_for_type(project, entity_type), f"{entity_type}.csv")


@router.get("/export/metrics/{category}")
def export_metrics_csv(category: str, entity_type: str | None = None, db: Session = Depends(get_db),
                       project: Project = Depends(get_project)):
    """The metric table exactly as the Analytics view shows it."""
    return _csv_download(ExportService(db).csv_for_metrics(project, category, entity_type), f"{entity_type or category}-metrics.csv")


def _csv_download(text: str, filename: str) -> PlainTextResponse:
    # attachment + filename: browsers and the desktop shell save it under a sensible name instead of rendering it
    return PlainTextResponse(text, media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})

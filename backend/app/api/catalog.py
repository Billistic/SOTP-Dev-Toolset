"""Schemas, field value catalogues, strings, assets and diagnostics."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..dao import AssetDAO, DiagnosticDAO, FieldDAO, StringDAO
from ..db import get_db
from ..models import Project
from ..sins.schemas.weapons import WEAPON_FIELDS, WEAPON_SOUND_LISTS, WEAPON_TEMPLATES
from ..sins.schemas import SCHEMAS, schema_for
from ..sins.schemas.fields import GROUPS
from ..services.export_service import ExportService
from ..services.validation_service import ValidationService
from .deps import get_project

router = APIRouter(tags=["catalog"])


# ── schemas ─────────────────────────────────────────────────────────────
@router.get("/schemas")
def list_schemas():
    return {"groups": GROUPS, "schemas": {k: v.to_dict() for k, v in SCHEMAS.items()}}


@router.get("/schemas/weapon")
def weapon_schema():
    """Field specs, sound-list blocks and starter templates for Weapon blocks."""
    return {"fields": [f.to_dict() for f in WEAPON_FIELDS],
            "soundLists": [{"key": k, "label": label, "when": when} for k, label, when in WEAPON_SOUND_LISTS],
            "templates": WEAPON_TEMPLATES}


@router.get("/schemas/{entity_type}")
def get_schema(entity_type: str):
    return schema_for(entity_type).to_dict()


@router.get("/fields/values")
def field_values(key: str, entity_type: str | None = None, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    vals = FieldDAO(db).distinct_values(project.id, key, entity_type)
    return sorted({v[1:-1] if len(v) >= 2 and v[0] == v[-1] == '"' else v for v in vals})



# ── strings ─────────────────────────────────────────────────────────────
class StringIn(BaseModel):
    value: str
    sourceFile: str = "String/English.str"


@router.get("/strings")
def list_strings(search: str | None = None, modified: bool = False, limit: int = Query(500, le=5000), offset: int = 0,
                 db: Session = Depends(get_db), project: Project = Depends(get_project)):
    dao = StringDAO(db)
    return {"total": dao.count(project.id),
            "rows": [s.to_dict() for s in dao.list(project.id, search=search, modified_only=modified, limit=limit, offset=offset)]}


@router.get("/strings/changes")
def string_changes(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    """Delta between the editor and the .str files on disk."""
    rows = [s.to_dict() for s in StringDAO(db).changes(project.id)]
    return {"new": [r for r in rows if r["isNew"]],
            "modified": [r for r in rows if r["isModified"] and not r["isNew"] and not r["isDeleted"]],
            "deleted": [r for r in rows if r["isDeleted"]]}


class RevertIn(BaseModel):
    ids: list[str] | None = None   # None reverts every change


@router.post("/strings/revert")
def revert_strings(body: RevertIn, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    dao = StringDAO(db)
    rows = dao.changes(project.id)
    if body.ids is not None:
        wanted = set(body.ids)
        rows = [r for r in rows if r.string_id in wanted]
    for r in rows:
        dao.revert(r)
    db.commit()
    return {"reverted": len(rows)}


@router.get("/strings/{string_id}")
def get_string(string_id: str, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    row = StringDAO(db).get_by_id(project.id, string_id)
    if row is None:
        raise HTTPException(404, "string not found")
    return row.to_dict()


@router.put("/strings/{string_id}")
def put_string(string_id: str, body: StringIn, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    row = StringDAO(db).upsert(project.id, string_id, body.value, body.sourceFile)
    db.commit()
    return row.to_dict()


@router.delete("/strings/{string_id}", status_code=204)
def delete_string(string_id: str, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    """Marks the row deleted (revertable); it leaves the .str file on the next strings write."""
    dao = StringDAO(db)
    row = dao.get_by_id(project.id, string_id)
    if row is None:
        raise HTTPException(404, "string not found")
    dao.mark_deleted(row)
    db.commit()


@router.post("/strings/write")
def write_strings(source_file: str = "String/English.str", db: Session = Depends(get_db), project: Project = Depends(get_project)):
    path = ExportService(db).write_strings(project, source_file)
    return {"written": str(path)}


# ── assets ──────────────────────────────────────────────────────────────
@router.get("/assets")
def list_assets(kind: str | None = None, search: str | None = None, source: str | None = None,
                limit: int = Query(500, le=5000), offset: int = 0,
                db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return [a.to_dict() for a in AssetDAO(db).list(project.id, kind=kind, search=search, source=source, limit=limit, offset=offset)]


@router.get("/assets/kinds")
def asset_kinds(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AssetDAO(db).kind_counts(project.id)


# ── diagnostics ─────────────────────────────────────────────────────────
@router.get("/diagnostics")
def list_diagnostics(severity: str | None = None, code: str | None = None, scope: str | None = None,
                     search: str | None = None, limit: int = Query(1000, le=10000), offset: int = 0,
                     db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return [d.to_dict() for d in DiagnosticDAO(db).list(project.id, severity=severity, code=code, scope=scope,
                                                         search=search, limit=limit, offset=offset)]


@router.get("/diagnostics/summary")
def diagnostics_summary(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return DiagnosticDAO(db).summary(project.id)


@router.post("/diagnostics/run")
def run_diagnostics(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    summary = ValidationService(db).run(project)
    db.commit()
    return summary

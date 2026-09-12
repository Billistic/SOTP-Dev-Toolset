"""Entity browsing, editing and per-entity relationships."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..dao import DiagnosticDAO, EntityDAO
from ..db import get_db
from ..models import Entity, Project
from ..sins import Document
from ..sins.schemas import schema_for
from ..sins.schemas.references import reference_kinds
from ..services.analytics_service import AnalyticsService
from ..services.edit_service import EditError, EditService
from ..services.export_service import ExportService
from .deps import get_entity, get_project

router = APIRouter(prefix="/entities", tags=["entities"])


class EditsIn(BaseModel):
    changes: list[dict[str, Any]]


class TextIn(BaseModel):
    text: str


class CreateIn(BaseModel):
    name: str
    text: str | None = None
    template: str | None = None      # copy an existing entity instead of supplying text
    ownStrings: bool = False         # give the copy its own <Name>_Name / <Name>_Desc strings


@router.get("")
def list_entities(entity_type: str | None = None, category: str | None = None, faction: str | None = None,
                  race: str | None = None, search: str | None = None, dirty: bool = False, errors: bool = False,
                  limit: int = Query(2000, le=5000), offset: int = 0,
                  db: Session = Depends(get_db), project: Project = Depends(get_project)):
    rows = EntityDAO(db).list(project.id, entity_type=entity_type, category=category, faction=faction, race=race,
                              search=search, dirty_only=dirty, with_errors=errors, limit=limit, offset=offset)
    return [e.summary() for e in rows]


@router.get("/types")
def entity_types(db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return EntityDAO(db).type_counts(project.id)


@router.post("", status_code=201)
def create_entity(body: CreateIn, db: Session = Depends(get_db), project: Project = Depends(get_project)):
    svc = EditService(db)
    try:
        entity = svc.create(project, body.name, body.text, template=body.template, own_strings=body.ownStrings)
    except EditError as exc:
        raise HTTPException(400, str(exc))
    return {**_detail(entity, db, project), "createdStrings": [s.to_dict() for s in svc.created_strings]}


@router.get("/{name}")
def get_entity_detail(entity: Entity = Depends(get_entity), db: Session = Depends(get_db),
                      project: Project = Depends(get_project)):
    return _detail(entity, db, project)


@router.get("/{name}/text", response_class=PlainTextResponse)
def get_entity_text(mode: str = "preserve", entity: Entity = Depends(get_entity), db: Session = Depends(get_db)):
    return EditService(db).render(entity, mode)


@router.put("/{name}/text")
def put_entity_text(body: TextIn, entity: Entity = Depends(get_entity), db: Session = Depends(get_db),
                    project: Project = Depends(get_project)):
    try:
        return _detail(EditService(db).replace_text(project, entity, body.text), db, project)
    except EditError as exc:
        raise HTTPException(400, str(exc))


@router.post("/{name}/edits")
def apply_edits(body: EditsIn, create_strings: bool = True, entity: Entity = Depends(get_entity),
                db: Session = Depends(get_db), project: Project = Depends(get_project)):
    svc = EditService(db)
    try:
        svc.apply(project, entity, body.changes, create_strings=create_strings)
    except (EditError, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc))
    return {**_detail(entity, db, project), "createdStrings": [s.to_dict() for s in svc.created_strings]}


@router.post("/{name}/revert")
def revert_entity(entity: Entity = Depends(get_entity), db: Session = Depends(get_db), project: Project = Depends(get_project)):
    try:
        return _detail(EditService(db).revert(project, entity), db, project)
    except EditError as exc:
        raise HTTPException(400, str(exc))


@router.post("/{name}/write")
def write_entity(mode: str = "preserve", entity: Entity = Depends(get_entity), db: Session = Depends(get_db),
                 project: Project = Depends(get_project)):
    path = ExportService(db).write_entity(project, entity, mode=mode)
    db.commit()
    return {"written": str(path), "entity": entity.summary()}


@router.delete("/{name}")
def delete_entity(move_file: bool = True, entity: Entity = Depends(get_entity), db: Session = Depends(get_db),
                  project: Project = Depends(get_project)):
    """Removes the entity from the project; the .entity file is moved to <mod>/.sotp-trash, never destroyed."""
    return EditService(db).delete(project, entity, move_file=move_file)


@router.get("/{name}/references")
def references_out(entity: Entity = Depends(get_entity), db: Session = Depends(get_db)):
    return [r.to_dict() for r in EntityDAO(db).references_out(entity.id)]


@router.get("/{name}/referenced-by")
def references_in(entity: Entity = Depends(get_entity), db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return [{"source": e.summary(), "path": r.path, "key": r.key} for r, e in EntityDAO(db).references_in(project.id, entity.name)]


@router.get("/{name}/diagnostics")
def entity_diagnostics(entity: Entity = Depends(get_entity), db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return [d.to_dict() for d in DiagnosticDAO(db).list(project.id, entity_id=entity.id)]


@router.get("/{name}/peers")
def entity_peers(entity: Entity = Depends(get_entity), db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return AnalyticsService(db).peer_profile(project, entity)


@router.get("/{name}/players")
def entity_players(entity: Entity = Depends(get_entity), db: Session = Depends(get_db), project: Project = Depends(get_project)):
    return [{"player": m.player_name, "slot": m.slot, "page": m.page, "ordinal": m.ordinal}
            for m in EntityDAO(db).members_of(project.id, entity.name)]


def _detail(entity: Entity, db: Session, project: Project) -> dict[str, Any]:
    doc = Document.from_json(entity.tree_json)
    weapons = [w.to_dict() for w in entity.weapons]
    return {
        **entity.summary(),
        "fmt": entity.fmt, "archiveVersion": entity.archive_version, "lineCount": entity.line_count,
        "tree": doc.to_json(),
        "typed": entity.typed_json,
        "weapons": weapons,
        "prerequisites": [{"subject": p.subject, "level": p.level} for p in entity.prerequisites],
        "modifiers": [{"type": m.modifier_type, "base": m.base_value, "perLevel": m.per_level_value, "isBool": m.is_bool}
                      for m in entity.modifiers],
        "schema": schema_for(entity.entity_type).to_dict(),
        "refKinds": reference_kinds(doc),
        "diagnostics": [d.to_dict() for d in DiagnosticDAO(db).list(project.id, entity_id=entity.id)],
    }

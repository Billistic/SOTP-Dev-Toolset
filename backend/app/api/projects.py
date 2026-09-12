"""Project CRUD, ingest trigger and filesystem browsing for the path picker."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..dao import ProjectDAO
from ..db import get_db
from ..models import Project
from ..services.analytics_service import AnalyticsService
from ..services.ingest_service import IngestService
from ..services.validation_service import ValidationService
from .deps import get_project

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectIn(BaseModel):
    name: str
    modRoot: str
    vanillaRoot: str | None = None
    outputRoot: str | None = None


class ProjectPatch(BaseModel):
    name: str | None = None
    modRoot: str | None = None
    vanillaRoot: str | None = None
    outputRoot: str | None = None


@router.get("")
def list_projects(db: Session = Depends(get_db)):
    return [p.to_dict() for p in ProjectDAO(db).list()]


@router.get("/active")
def active_project(project: Project = Depends(get_project)):
    return project.to_dict()


@router.post("", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    if not Path(body.modRoot).is_dir():
        raise HTTPException(400, f"mod root does not exist: {body.modRoot}")
    project = ProjectDAO(db).create(name=body.name, mod_root=body.modRoot, vanilla_root=body.vanillaRoot or None,
                                    output_root=body.outputRoot or None)
    db.commit()
    return project.to_dict()


@router.put("/{project_id}")
def update_project(project_id: int, body: ProjectPatch, db: Session = Depends(get_db)):
    dao = ProjectDAO(db)
    project = dao.update_fields(project_id, name=body.name, mod_root=body.modRoot)
    if project is None:
        raise HTTPException(404, "project not found")
    # empty string clears an optional root; None leaves it untouched
    if body.vanillaRoot is not None:
        project.vanilla_root = body.vanillaRoot or None
    if body.outputRoot is not None:
        project.output_root = body.outputRoot or None
    db.commit()
    return project.to_dict()


@router.post("/{project_id}/activate")
def activate_project(project_id: int, db: Session = Depends(get_db)):
    project = ProjectDAO(db).activate(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    db.commit()
    return project.to_dict()


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)):
    if not ProjectDAO(db).remove(project_id):
        raise HTTPException(404, "project not found")
    db.commit()


@router.post("/{project_id}/ingest")
def ingest_project(project_id: int, force: bool = False, db: Session = Depends(get_db)):
    project = ProjectDAO(db).get(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    try:
        return IngestService(db).ingest(project, force=force)
    except FileNotFoundError as exc:
        raise HTTPException(400, str(exc))


@router.post("/{project_id}/validate")
def validate_project(project_id: int, db: Session = Depends(get_db)):
    project = ProjectDAO(db).get(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    summary = ValidationService(db).run(project)
    db.commit()
    return summary


@router.get("/{project_id}/overview")
def project_overview(project_id: int, db: Session = Depends(get_db)):
    project = ProjectDAO(db).get(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    return AnalyticsService(db).overview(project)


@router.get("/browse")
def browse(path: str = ""):
    """Directory listing for the folder picker (directories only)."""
    if not path:
        drives = [f"{c}:/" for c in "CDEFGHIJKLMNOPQRSTUVWXYZ" if Path(f"{c}:/").exists()]
        return {"path": "", "parent": None, "dirs": drives, "isModRoot": False}
    p = Path(path)
    if not p.is_dir():
        raise HTTPException(400, "not a directory")
    dirs = sorted(str(c).replace("\\", "/") for c in p.iterdir() if c.is_dir() and not c.name.startswith("."))
    return {"path": str(p).replace("\\", "/"), "parent": str(p.parent).replace("\\", "/") if p.parent != p else "",
            "dirs": dirs, "isModRoot": (p / "GameInfo").is_dir() and (p / "entity.manifest").is_file()}

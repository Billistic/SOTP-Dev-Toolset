"""Project CRUD, ingest trigger and filesystem browsing for the path picker."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_registry, project_session
from ..models import Project
from ..services.analytics_service import AnalyticsService
from ..services.ingest_service import IngestService
from ..services.project_registry import ProjectRegistry
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
def list_projects(reg: Session = Depends(get_registry)):
    return [p.to_dict() for p in ProjectRegistry(reg).list()]


@router.get("/active")
def active_project(project: Project = Depends(get_project)):
    return project.to_dict()


@router.post("", status_code=201)
def create_project(body: ProjectIn, reg: Session = Depends(get_registry)):
    if not Path(body.modRoot).is_dir():
        raise HTTPException(400, f"mod root does not exist: {body.modRoot}")
    project = ProjectRegistry(reg).create(name=body.name, mod_root=body.modRoot, vanilla_root=body.vanillaRoot or None,
                                          output_root=body.outputRoot or None)
    return project.to_dict()


@router.put("/{project_id}")
def update_project(project_id: int, body: ProjectPatch, reg: Session = Depends(get_registry)):
    project = ProjectRegistry(reg).update(project_id, name=body.name, mod_root=body.modRoot,
                                          vanilla_root=body.vanillaRoot, output_root=body.outputRoot)
    if project is None:
        raise HTTPException(404, "project not found")
    return project.to_dict()


@router.post("/{project_id}/activate")
def activate_project(project_id: int, reg: Session = Depends(get_registry)):
    project = ProjectRegistry(reg).activate(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    return project.to_dict()


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, reg: Session = Depends(get_registry)):
    """Removes the project and deletes its database file; the mod folder itself is never touched."""
    if not ProjectRegistry(reg).remove(project_id):
        raise HTTPException(404, "project not found")


@contextmanager
def _project_db(project_id: int, reg: Session) -> Iterator[tuple[Session, Project]]:
    """Session on one project's own data file (it need not be the active project)."""
    registry = ProjectRegistry(reg)
    if registry.get(project_id) is None:
        raise HTTPException(404, "project not found")
    registry.mirror(registry.get(project_id))
    with project_session(project_id) as db:
        yield db, db.get(Project, project_id)


@router.post("/{project_id}/ingest")
def ingest_project(project_id: int, force: bool = False, reg: Session = Depends(get_registry)):
    with _project_db(project_id, reg) as (db, project):
        try:
            stats = IngestService(db).ingest(project, force=force)
        except FileNotFoundError as exc:
            raise HTTPException(400, str(exc))
    ProjectRegistry(reg).sync_back(project_id)
    return stats


@router.post("/{project_id}/validate")
def validate_project(project_id: int, reg: Session = Depends(get_registry)):
    with _project_db(project_id, reg) as (db, project):
        summary = ValidationService(db).run(project)
        db.commit()
        return summary


@router.get("/{project_id}/overview")
def project_overview(project_id: int, reg: Session = Depends(get_registry)):
    with _project_db(project_id, reg) as (db, project):
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

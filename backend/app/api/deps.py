"""FastAPI dependencies shared by every router."""
from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..dao import EntityDAO, ProjectDAO
from ..db import get_db
from ..models import Entity, Project


def get_project(db: Session = Depends(get_db)) -> Project:
    project = ProjectDAO(db).active()
    if project is None:
        raise HTTPException(status_code=404, detail="No active project. Create one via POST /api/projects.")
    return project


def get_entity(name: str, db: Session = Depends(get_db), project: Project = Depends(get_project)) -> Entity:
    entity = EntityDAO(db).by_name(project.id, name)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"entity '{name}' not found")
    return entity

"""
Project registry: CRUD on the registry DB, mirrored into each project's own data file.

The mirror row (same id, always ``is_active``) is what request-scoped services see through ``get_project``;
the registry copy is what the project switcher lists.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..dao import ProjectDAO
from ..db import drop_project_db, project_session
from ..models import Project

_FIELDS = ("name", "mod_root", "vanilla_root", "output_root", "created_at", "last_ingest_at")


class ProjectRegistry:
    def __init__(self, reg: Session):
        self.reg = reg
        self.dao = ProjectDAO(reg)

    def list(self) -> list[Project]:
        return self.dao.list()

    def get(self, project_id: int) -> Project | None:
        return self.dao.get(project_id)

    def create(self, **kwargs) -> Project:
        project = self.dao.create(**kwargs)
        self.reg.commit()
        self.mirror(project)
        return project

    def update(self, project_id: int, *, name=None, mod_root=None, vanilla_root=None, output_root=None) -> Project | None:
        project = self.dao.update_fields(project_id, name=name, mod_root=mod_root)
        if project is None:
            return None
        # empty string clears an optional root; None leaves it untouched
        if vanilla_root is not None:
            project.vanilla_root = vanilla_root or None
        if output_root is not None:
            project.output_root = output_root or None
        self.reg.commit()
        self.mirror(project)
        return project

    def activate(self, project_id: int) -> Project | None:
        project = self.dao.activate(project_id)
        self.reg.commit()
        if project is not None:
            self.mirror(project)   # creates the data file if this project never had one
        return project

    def remove(self, project_id: int) -> bool:
        project = self.dao.get(project_id)
        if project is None:
            return False
        was_active = project.is_active
        self.dao.remove(project_id)
        self.reg.commit()
        drop_project_db(project_id)
        if was_active:
            rest = self.dao.list()
            if rest:
                self.activate(rest[0].id)
        return True

    def mirror(self, project: Project) -> None:
        """Copy the registry row into the project's own data file."""
        with project_session(project.id) as db:
            row = db.get(Project, project.id) or Project(id=project.id)
            for f in _FIELDS:
                if f != "last_ingest_at" or getattr(project, f) is not None:
                    setattr(row, f, getattr(project, f))
            row.is_active = True
            db.add(row)
            db.commit()

    def sync_back(self, project_id: int) -> None:
        """After an ingest the data file knows the new ``last_ingest_at``; show it in the switcher too."""
        with project_session(project_id) as db:
            row = db.get(Project, project_id)
            stamp = row.last_ingest_at if row else None
        project = self.dao.get(project_id)
        if project is not None and stamp is not None:
            project.last_ingest_at = stamp
            self.reg.commit()

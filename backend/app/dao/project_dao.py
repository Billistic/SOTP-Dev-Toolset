"""Project persistence."""
from __future__ import annotations

from sqlalchemy import update

from ..models import Project
from .base import BaseDAO


class ProjectDAO(BaseDAO[Project]):
    model = Project

    def list(self) -> list[Project]:
        return self.scalars(self.select().order_by(Project.id))

    def active(self) -> Project | None:
        return self.first(self.select().where(Project.is_active.is_(True)))

    def create(self, **kwargs) -> Project:
        project = Project(**kwargs)
        self.add(project)
        self.flush()
        if self.active() is None:
            self.activate(project.id)
        return project

    def activate(self, project_id: int) -> Project | None:
        self.db.execute(update(Project).values(is_active=False))
        project = self.get(project_id)
        if project is not None:
            project.is_active = True
        return project

    def update_fields(self, project_id: int, **kwargs) -> Project | None:
        project = self.get(project_id)
        if project is None:
            return None
        for k, v in kwargs.items():
            if v is not None:
                setattr(project, k, v)
        return project

    def remove(self, project_id: int) -> bool:
        project = self.get(project_id)
        if project is None:
            return False
        self.db.delete(project)
        return True

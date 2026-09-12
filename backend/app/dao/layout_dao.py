"""Persistence for relationship-builder node positions."""
from __future__ import annotations

from typing import Any

from ..models import GraphLayout
from .base import BaseDAO


class LayoutDAO(BaseDAO[GraphLayout]):
    model = GraphLayout

    def get(self, project_id: int, view_key: str) -> GraphLayout | None:  # type: ignore[override]
        return self.first(self.select().where(GraphLayout.project_id == project_id, GraphLayout.view_key == view_key))

    def save(self, project_id: int, view_key: str, positions: dict[str, Any], *, merge: bool = True) -> GraphLayout:
        row = self.get(project_id, view_key)
        if row is None:
            row = GraphLayout(project_id=project_id, view_key=view_key, positions={})
            self.db.add(row)
        row.positions = {**row.positions, **positions} if merge else dict(positions)
        return row

    def clear(self, project_id: int, view_key: str) -> None:
        row = self.get(project_id, view_key)
        if row is not None:
            self.db.delete(row)

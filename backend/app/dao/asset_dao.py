"""Asset index persistence and lookups."""
from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select

from ..models import Asset
from .base import BaseDAO, search_clause


class AssetDAO(BaseDAO[Asset]):
    model = Asset

    def replace_source(self, project_id: int, source: str, rows: list[Asset]) -> None:
        self.db.execute(delete(Asset).where(Asset.project_id == project_id, Asset.source == source))
        for r in rows:
            r.project_id = project_id
            r.source = source
        self.db.add_all(rows)

    def lookup(self, project_id: int) -> dict[str, dict[str, str]]:
        """kind -> {name_lower: source}; mod entries override vanilla ones."""
        out: dict[str, dict[str, str]] = {}
        rows = self.db.execute(select(Asset.kind, Asset.name_lower, Asset.source)
                               .where(Asset.project_id == project_id)
                               .order_by(Asset.source.desc())).all()  # vanilla first, mod overwrites
        for kind, name, source in rows:
            out.setdefault(kind, {})[name] = source
        return out

    def list(self, project_id: int, kind: str | None = None, search: str | None = None,
             source: str | None = None, limit: int = 500, offset: int = 0) -> list[Asset]:
        stmt = self.select().where(Asset.project_id == project_id)
        if kind:
            stmt = stmt.where(Asset.kind == kind)
        if source:
            stmt = stmt.where(Asset.source == source)
        if search:
            stmt = stmt.where(search_clause(search, Asset.name_lower, Asset.path))
        return self.scalars(stmt.order_by(Asset.kind, Asset.name).limit(limit).offset(offset))

    def kind_counts(self, project_id: int) -> list[dict[str, Any]]:
        rows = self.db.execute(select(Asset.kind, Asset.source, func.count()).where(Asset.project_id == project_id)
                               .group_by(Asset.kind, Asset.source).order_by(Asset.kind)).all()
        return [{"kind": k, "source": s, "count": n} for k, s, n in rows]

    def get_named(self, project_id: int, kind: str, name: str) -> Asset | None:
        return self.first(self.select().where(Asset.project_id == project_id, Asset.kind == kind,
                                              Asset.name_lower == name.lower()).order_by(Asset.source))

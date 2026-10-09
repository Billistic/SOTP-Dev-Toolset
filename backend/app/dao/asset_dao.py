"""Asset index persistence and lookups."""
from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, or_, select

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

    def _filtered(self, stmt, project_id: int, kind: str | None, search: str | None, source: str | None, folder: str | None):
        stmt = stmt.where(Asset.project_id == project_id)
        if kind:
            stmt = stmt.where(Asset.kind == kind)
        if source:
            stmt = stmt.where(Asset.source == source)
        if search:
            stmt = stmt.where(search_clause(search, Asset.name_lower, Asset.path))
        if folder is not None:   # files directly in that folder; "" = no folder (root files, in-file definitions)
            if folder == "":
                stmt = stmt.where(or_(Asset.path.is_(None), ~Asset.path.like("%/%")))
            else:
                esc = folder.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
                stmt = stmt.where(Asset.path.like(f"{esc}/%", escape="\\"), ~Asset.path.like(f"{esc}/%/%", escape="\\"))
        return stmt

    def list(self, project_id: int, kind: str | None = None, search: str | None = None,
             source: str | None = None, folder: str | None = None, limit: int = 500, offset: int = 0) -> list[Asset]:
        """Mod assets first, then the base game's, each alphabetical: with a base game indexed there are thousands of
        vanilla files, and a plain name sort let them fill every page so the mod's own never showed."""
        stmt = self._filtered(self.select(), project_id, kind, search, source, folder)
        return self.scalars(stmt.order_by(Asset.kind, Asset.source != "mod", Asset.name_lower).limit(limit).offset(offset))

    def summary(self, project_id: int, kind: str | None = None, search: str | None = None,
                source: str | None = None) -> dict[str, Any]:
        """Total matches per source and the folders they sit in, over the whole result (not just the loaded page)."""
        rows = self.db.execute(self._filtered(select(Asset.path, Asset.source), project_id, kind, search, source, None)).all()
        folders: dict[str, int] = {}
        by_source: dict[str, int] = {}
        for path, src in rows:
            d = path.rsplit("/", 1)[0] if path and "/" in path else ""
            folders[d] = folders.get(d, 0) + 1
            by_source[src] = by_source.get(src, 0) + 1
        return {"total": len(rows), "bySource": by_source,
                "folders": [{"folder": f, "count": n} for f, n in sorted(folders.items())]}

    def kind_counts(self, project_id: int) -> list[dict[str, Any]]:
        rows = self.db.execute(select(Asset.kind, Asset.source, func.count()).where(Asset.project_id == project_id)
                               .group_by(Asset.kind, Asset.source).order_by(Asset.kind)).all()
        return [{"kind": k, "source": s, "count": n} for k, s, n in rows]

    def get_named(self, project_id: int, kind: str, name: str) -> Asset | None:
        return self.first(self.select().where(Asset.project_id == project_id, Asset.kind == kind,
                                              Asset.name_lower == name.lower()).order_by(Asset.source))

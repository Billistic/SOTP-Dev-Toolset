"""Diagnostic persistence and aggregation."""
from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select

from ..models import Diagnostic
from .base import BaseDAO

_ORDER = {"error": 0, "warning": 1, "info": 2}


class DiagnosticDAO(BaseDAO[Diagnostic]):
    model = Diagnostic

    def clear(self, project_id: int, entity_id: int | None = None, scopes: tuple[str, ...] | None = None) -> None:
        stmt = delete(Diagnostic).where(Diagnostic.project_id == project_id)
        if entity_id is not None:
            stmt = stmt.where(Diagnostic.entity_id == entity_id)
        if scopes:
            stmt = stmt.where(Diagnostic.scope.in_(scopes))
        self.db.execute(stmt)

    def list(self, project_id: int, *, severity: str | None = None, code: str | None = None,
             scope: str | None = None, entity_id: int | None = None, search: str | None = None,
             limit: int = 1000, offset: int = 0) -> list[Diagnostic]:
        stmt = self.select().where(Diagnostic.project_id == project_id)
        if severity:
            stmt = stmt.where(Diagnostic.severity == severity)
        if code:
            stmt = stmt.where(Diagnostic.code == code)
        if scope:
            stmt = stmt.where(Diagnostic.scope == scope)
        if entity_id is not None:
            stmt = stmt.where(Diagnostic.entity_id == entity_id)
        if search:
            like = f"%{search}%"
            stmt = stmt.where(Diagnostic.message.ilike(like) | Diagnostic.entity_name.ilike(like) | Diagnostic.target.ilike(like))
        rows = self.scalars(stmt.order_by(Diagnostic.entity_name, Diagnostic.id).limit(limit).offset(offset))
        return sorted(rows, key=lambda d: (_ORDER.get(d.severity, 3), d.entity_name or "", d.id))

    def summary(self, project_id: int) -> dict[str, Any]:
        by_sev = self.db.execute(select(Diagnostic.severity, func.count()).where(Diagnostic.project_id == project_id)
                                 .group_by(Diagnostic.severity)).all()
        by_code = self.db.execute(select(Diagnostic.code, Diagnostic.severity, func.count())
                                  .where(Diagnostic.project_id == project_id)
                                  .group_by(Diagnostic.code, Diagnostic.severity).order_by(func.count().desc())).all()
        return {"bySeverity": {k: int(v) for k, v in by_sev},
                "byCode": [{"code": c, "severity": s, "count": n} for c, s, n in by_code]}

    def counts_per_entity(self, project_id: int) -> dict[int, tuple[int, int]]:
        rows = self.db.execute(select(Diagnostic.entity_id, Diagnostic.severity, func.count())
                               .where(Diagnostic.project_id == project_id, Diagnostic.entity_id.is_not(None))
                               .group_by(Diagnostic.entity_id, Diagnostic.severity)).all()
        out: dict[int, list[int]] = {}
        for eid, sev, n in rows:
            slot = out.setdefault(eid, [0, 0])
            if sev == "error":
                slot[0] += n
            elif sev == "warning":
                slot[1] += n
        return {k: (v[0], v[1]) for k, v in out.items()}

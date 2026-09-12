"""Results of a validation run: one row per finding."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from .project import utcnow


class Diagnostic(Base):
    __tablename__ = "diagnostics"
    __table_args__ = (Index("ix_diag_project_sev", "project_id", "severity"),
                      Index("ix_diag_code", "project_id", "code"))

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id: Mapped[int | None] = mapped_column(ForeignKey("entities.id", ondelete="CASCADE"), index=True)
    entity_name: Mapped[str | None] = mapped_column(String(200), index=True)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)     # entity | reference | manifest | string | asset | research | player
    severity: Mapped[str] = mapped_column(String(10), nullable=False)  # error | warning | info
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    path: Mapped[str | None] = mapped_column(String(300))
    line: Mapped[int | None] = mapped_column(Integer)
    target: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "entityId": self.entity_id, "entityName": self.entity_name, "scope": self.scope,
                "severity": self.severity, "code": self.code, "message": self.message, "path": self.path,
                "line": self.line, "target": self.target}

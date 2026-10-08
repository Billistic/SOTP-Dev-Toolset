"""Entities kept out of the balance statistics (dev / debug / empty / AI-driver units), keyed by name so the
flag survives re-ingests and file moves (QA #3)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from .project import utcnow

EXCLUSION_REASONS = ("dev", "debug", "empty", "ai", "other")


class BalanceExclusion(Base):
    __tablename__ = "balance_exclusions"
    __table_args__ = (UniqueConstraint("project_id", "entity_name", name="uq_balance_exclusion"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_name: Mapped[str] = mapped_column(String(200), nullable=False)
    reason: Mapped[str] = mapped_column(String(20), nullable=False, default="other")
    note: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {"entity": self.entity_name, "reason": self.reason, "note": self.note,
                "createdAt": self.created_at.isoformat() if self.created_at else None}

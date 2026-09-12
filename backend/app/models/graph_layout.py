"""Saved node positions for the relationship builder, one row per named view."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base
from .project import utcnow


class GraphLayout(Base):
    __tablename__ = "graph_layouts"
    __table_args__ = (UniqueConstraint("project_id", "view_key", name="uq_layout_view"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    view_key: Mapped[str] = mapped_column(String(160), nullable=False)
    positions: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)   # node id -> {x, y}
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    def to_dict(self) -> dict[str, Any]:
        return {"viewKey": self.view_key, "positions": self.positions, "updatedAt": self.updated_at.isoformat() if self.updated_at else None}

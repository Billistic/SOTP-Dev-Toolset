"""A project is one mod workspace: where the mod lives and (optionally) the base game."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    mod_root: Mapped[str] = mapped_column(String(1024), nullable=False)
    vanilla_root: Mapped[str | None] = mapped_column(String(1024))
    output_root: Mapped[str | None] = mapped_column(String(1024))   # None → write in place
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    last_ingest_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "modRoot": self.mod_root, "vanillaRoot": self.vanilla_root,
                "outputRoot": self.output_root, "isActive": self.is_active,
                "lastIngestAt": self.last_ingest_at.isoformat() if self.last_ingest_at else None}

"""
Index of everything an entity can point at that is not an entity or a string:
mesh / particle / texture files, sound & music definitions, brushes, explosions.
``source`` distinguishes the mod's own files from base-game fallbacks.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (Index("ix_asset_lookup", "project_id", "kind", "name_lower"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)     # mesh particle texture sound music brush explosion texanim fx ogg
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    name_lower: Mapped[str] = mapped_column(String(300), nullable=False)
    path: Mapped[str | None] = mapped_column(String(1024))            # relative file path (None for in-file definitions)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="mod")
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    file_hash: Mapped[str | None] = mapped_column(String(64))
    meta: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "name": self.name, "path": self.path, "source": self.source,
                "sizeBytes": self.size_bytes, "meta": self.meta}

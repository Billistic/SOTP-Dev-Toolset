"""Localisation strings from the mod's .str files."""
from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class GameString(Base):
    __tablename__ = "game_strings"
    __table_args__ = (UniqueConstraint("project_id", "source_file", "string_id", name="uq_string_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    string_id: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    original_value: Mapped[str] = mapped_column(Text, nullable=False)
    is_modified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_new: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)   # created in the editor
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # removed in the editor, still on disk
    source_file: Mapped[str] = mapped_column(String(300), nullable=False)
    line_no: Mapped[int | None] = mapped_column(Integer)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "stringId": self.string_id, "value": self.value, "originalValue": self.original_value,
                "isModified": self.is_modified, "isNew": self.is_new, "isDeleted": self.is_deleted, "sourceFile": self.source_file,
                "line": self.line_no, "duplicateCount": self.duplicate_count}

"""Localisation string persistence."""
from __future__ import annotations

from sqlalchemy import func, or_, select

from ..models import GameString
from .base import BaseDAO, search_clause


class StringDAO(BaseDAO[GameString]):
    model = GameString

    def get_by_id(self, project_id: int, string_id: str) -> GameString | None:
        return self.first(self.select().where(GameString.project_id == project_id, GameString.string_id == string_id))

    def id_set(self, project_id: int) -> set[str]:
        rows = self.db.execute(select(GameString.string_id)
                               .where(GameString.project_id == project_id, GameString.is_deleted.is_(False))).all()
        return {s for (s,) in rows}

    def value_map(self, project_id: int) -> dict[str, str]:
        rows = self.db.execute(select(GameString.string_id, GameString.value)
                               .where(GameString.project_id == project_id, GameString.is_deleted.is_(False))).all()
        return dict(rows)

    def list(self, project_id: int, *, search: str | None = None, modified_only: bool = False,
             limit: int = 500, offset: int = 0) -> list[GameString]:
        stmt = self.select().where(GameString.project_id == project_id)
        if search:
            stmt = stmt.where(search_clause(search, GameString.string_id, GameString.value))
        if modified_only:
            stmt = stmt.where(or_(GameString.is_modified.is_(True), GameString.is_new.is_(True), GameString.is_deleted.is_(True)))
        else:
            stmt = stmt.where(GameString.is_deleted.is_(False))
        return self.scalars(stmt.order_by(GameString.string_id).limit(limit).offset(offset))

    def count(self, project_id: int) -> int:
        return self.db.scalar(select(func.count()).select_from(GameString)
                              .where(GameString.project_id == project_id, GameString.is_deleted.is_(False))) or 0

    def changes(self, project_id: int) -> list[GameString]:
        """Every row that differs from the .str files on disk."""
        return self.scalars(self.select().where(
            GameString.project_id == project_id,
            or_(GameString.is_modified.is_(True), GameString.is_new.is_(True), GameString.is_deleted.is_(True)),
        ).order_by(GameString.source_file, GameString.string_id))

    def revert(self, row: GameString) -> bool:
        """Undo editor changes on one row; returns False when the row ceased to exist (it was new)."""
        if row.is_new:
            self.db.delete(row)
            return False
        row.value, row.is_modified, row.is_deleted = row.original_value, False, False
        return True

    def mark_deleted(self, row: GameString) -> None:
        if row.is_new:
            self.db.delete(row)   # never on disk: nothing to track
        else:
            row.is_deleted = True

    def replace_all(self, project_id: int, rows: list[GameString], source_file: str) -> None:
        """Re-ingest one .str file, keeping user edits that are still relevant."""
        existing = {s.string_id: s for s in self.scalars(
            self.select().where(GameString.project_id == project_id, GameString.source_file == source_file))}
        seen: set[str] = set()
        for row in rows:
            row.project_id = project_id
            old = existing.get(row.string_id)
            if old is None:
                self.db.add(row)
            else:  # keep the modified / deleted intent across re-ingests
                old.original_value = row.original_value
                old.line_no = row.line_no
                old.duplicate_count = row.duplicate_count
                if not old.is_modified:
                    old.value = row.value
            seen.add(row.string_id)
        for sid, old in existing.items():
            if sid not in seen and not old.is_new:
                self.db.delete(old)

    def upsert(self, project_id: int, string_id: str, value: str, source_file: str) -> GameString:
        row = self.get_by_id(project_id, string_id)
        if row is None:
            row = GameString(project_id=project_id, string_id=string_id, value=value, original_value="",
                             is_modified=True, is_new=True, source_file=source_file)
            self.db.add(row)
        else:
            row.value = value
            row.is_modified = value != row.original_value
            row.is_deleted = False
        return row

    def source_files(self, project_id: int) -> list[str]:
        rows = self.db.execute(select(GameString.source_file).where(GameString.project_id == project_id).distinct()).all()
        return [f for (f,) in rows]

    def all_for_file(self, project_id: int, source_file: str) -> list[GameString]:
        # rows created in the editor have no line number yet and go at the end of the file
        return self.scalars(self.select().where(GameString.project_id == project_id, GameString.source_file == source_file)
                            .order_by(GameString.line_no.is_(None), GameString.line_no, GameString.id))

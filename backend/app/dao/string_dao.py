"""Localisation string persistence."""
from __future__ import annotations

from sqlalchemy import case, exists, func, or_, select
from sqlalchemy.orm import aliased

from ..models import GameString
from .base import BaseDAO, search_clause


PRIMARY_STR = "String/English.str"
MAX_STRING_LEN = 256   # longest Value the game reads safely (QA #11); longer ones are flagged, not refused


class StringDAO(BaseDAO[GameString]):
    """One row per (string ID, .str file): English.str, French.str ... are separate, never merged (QA #13).
    Lookups without a file prefer the primary English.str."""
    model = GameString

    def get_by_id(self, project_id: int, string_id: str, source_file: str | None = None) -> GameString | None:
        stmt = self.select().where(GameString.project_id == project_id, GameString.string_id == string_id)
        if source_file:
            return self.first(stmt.where(GameString.source_file == source_file))
        return self.first(stmt.order_by(GameString.source_file != PRIMARY_STR, GameString.source_file))

    def id_set(self, project_id: int) -> set[str]:
        rows = self.db.execute(select(GameString.string_id)
                               .where(GameString.project_id == project_id, GameString.is_deleted.is_(False))).all()
        return {s for (s,) in rows}

    def value_map(self, project_id: int) -> dict[str, str]:
        """string ID -> text; the primary file wins over translations (its rows come last)."""
        rows = self.db.execute(select(GameString.string_id, GameString.value)
                               .where(GameString.project_id == project_id, GameString.is_deleted.is_(False))
                               .order_by(GameString.source_file == PRIMARY_STR)).all()
        return dict(rows)

    def primary_map(self, project_id: int) -> dict[str, str]:
        """string ID -> English text: the reference every translation is built against (QA #14)."""
        rows = self.db.execute(select(GameString.string_id, GameString.value).where(
            GameString.project_id == project_id, GameString.source_file == PRIMARY_STR, GameString.is_deleted.is_(False))).all()
        return dict(rows)

    def list(self, project_id: int, *, search: str | None = None, modified_only: bool = False, source_file: str | None = None,
             too_long: bool = False, vs_primary: str | None = None, limit: int = 500, offset: int = 0) -> list[GameString]:
        """``vs_primary``: ``untranslated`` (same text as English.str) or ``orphan`` (ID not in English.str)."""
        stmt = self.select().where(GameString.project_id == project_id)
        if source_file:
            stmt = stmt.where(GameString.source_file == source_file)
        if vs_primary in ("untranslated", "orphan"):
            p = aliased(GameString)
            ref = exists().where(p.project_id == project_id, p.source_file == PRIMARY_STR, p.is_deleted.is_(False),
                                 p.string_id == GameString.string_id)
            stmt = stmt.where(ref.where(p.value == GameString.value) if vs_primary == "untranslated" else ~ref)
        if too_long:
            stmt = stmt.where(func.length(GameString.value) > MAX_STRING_LEN)
        if search:
            stmt = stmt.where(search_clause(search, GameString.string_id, GameString.value))
        if modified_only:
            stmt = stmt.where(or_(GameString.is_modified.is_(True), GameString.is_new.is_(True), GameString.is_deleted.is_(True)))
        else:
            stmt = stmt.where(GameString.is_deleted.is_(False))
        return self.scalars(stmt.order_by(GameString.string_id, GameString.source_file).limit(limit).offset(offset))

    def count(self, project_id: int, source_file: str | None = None) -> int:
        stmt = select(func.count()).select_from(GameString).where(GameString.project_id == project_id, GameString.is_deleted.is_(False))
        if source_file:
            stmt = stmt.where(GameString.source_file == source_file)
        return self.db.scalar(stmt) or 0

    def file_summary(self, project_id: int) -> list[dict]:
        """Each .str file with its string count, pending changes and over-length values; primary first."""
        changed = or_(GameString.is_modified.is_(True), GameString.is_new.is_(True), GameString.is_deleted.is_(True))
        rows = self.db.execute(select(
            GameString.source_file,
            func.sum(case((GameString.is_deleted.is_(False), 1), else_=0)),
            func.sum(case((changed, 1), else_=0)),
            func.sum(case((func.length(GameString.value) > MAX_STRING_LEN, 1), else_=0)),
        ).where(GameString.project_id == project_id).group_by(GameString.source_file)).all()
        out = [{"file": f, "count": int(n or 0), "changes": int(c or 0), "tooLong": int(t or 0)} for f, n, c, t in rows]
        primary = self.primary_map(project_id)
        if primary:   # how far each translation is from English.str
            for r in out:
                if r["file"] == PRIMARY_STR:
                    continue
                mine = dict(self.db.execute(select(GameString.string_id, GameString.value).where(
                    GameString.project_id == project_id, GameString.source_file == r["file"], GameString.is_deleted.is_(False))).all())
                r["missing"] = sum(1 for sid in primary if sid not in mine)
                r["untranslated"] = sum(1 for sid, v in mine.items() if primary.get(sid) == v)
                r["orphans"] = sum(1 for sid in mine if sid not in primary)
        return sorted(out, key=lambda r: (r["file"] != PRIMARY_STR, r["file"]))

    def fill_from_primary(self, project_id: int, target: str) -> int:
        """Add every English.str ID missing from ``target`` to it, pre-filled with the English text (new rows, written
        on the next write of that file). Also how a new language file is started."""
        if target == PRIMARY_STR:
            return 0
        have = {s for (s,) in self.db.execute(select(GameString.string_id).where(
            GameString.project_id == project_id, GameString.source_file == target))}
        added = 0
        for row in self.all_for_file(project_id, PRIMARY_STR):
            if row.is_deleted or row.string_id in have:
                continue
            self.db.add(GameString(project_id=project_id, string_id=row.string_id, value=row.value, original_value="",
                                   is_modified=True, is_new=True, source_file=target))
            added += 1
        return added

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
        row = self.get_by_id(project_id, string_id, source_file)   # this file's row only, never a translation's
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

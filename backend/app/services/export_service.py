"""
Writes database state back to the mod: entity files, string tables, the
entity manifest, and CSV exports for spreadsheet-based balancing.
"""
from __future__ import annotations

import csv
import hashlib
import io
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy.orm import Session

from ..dao import EntityDAO, StringDAO
from ..models import Entity, Project
from ..models.project import utcnow
from ..sins import Document, parse
from ..sins.writer import write
from ..sins.schemas import schema_for
from .asset_indexer import read_manifest


class ExportService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)
        self.strings = StringDAO(db)

    # ── entities ────────────────────────────────────────────────────────
    def write_entity(self, project: Project, entity: Entity, *, mode: str = "preserve") -> Path:
        """Write one entity to the output root (or in place) and clear its dirty flag."""
        text = write(Document.from_json(entity.tree_json), mode)
        path = self._target(project, entity.source_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="")
        if self._in_place(project):
            entity.file_hash = hashlib.md5(text.encode("utf-8")).hexdigest()
            entity.is_dirty = False
            entity.source_missing = False
        entity.written_at = utcnow()
        # keep the stored tree byte-consistent with what is now on disk
        fresh = parse(text, entity.source_path)
        entity.tree_json = fresh.to_json(include_raw=True)
        return path

    def write_dirty(self, project: Project, mode: str = "preserve") -> list[str]:
        written = []
        for e in self.entities.list(project.id, dirty_only=True, limit=100000):
            self.write_entity(project, e, mode=mode)
            written.append(e.source_path)
        self.db.commit()
        return written

    def write_manifest(self, project: Project) -> Path:
        """Rewrite entity.manifest: keep the existing order, drop entries with no entity, append new ones."""
        wanted = {e.source_path.rsplit("/", 1)[-1] for e in self.entities.all_for_project(project.id)}
        current = read_manifest(Path(project.mod_root), "entity.manifest")
        names: list[str] = []
        for n in current:
            if n in wanted and n not in names:
                names.append(n)
        names += sorted(wanted - set(names))
        lines = ["TXT", f"entityNameCount {len(names)}"] + [f'entityName "{n}"' for n in names]
        path = self._target(project, "entity.manifest")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="")
        return path

    # ── strings ─────────────────────────────────────────────────────────
    def write_strings(self, project: Project, source_file: str = "String/English.str") -> Path:
        rows = self.strings.all_for_file(project.id, source_file)
        kept = [r for r in rows if not r.is_deleted]
        lines = ["TXT", f"NumStrings {len(kept)}"]
        for r in kept:
            lines += ["StringInfo", f'\tID "{r.string_id}"', f'\tValue "{r.value}"']
        path = self._target(project, source_file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="")
        if self._in_place(project):   # disk now matches the editor: reset the change tracking
            for r in rows:
                if r.is_deleted:
                    self.db.delete(r)
                else:
                    r.original_value, r.is_modified, r.is_new = r.value, False, False
        self.db.commit()
        return path

    # ── CSV ─────────────────────────────────────────────────────────────
    def csv_for_type(self, project: Project, entity_type: str) -> str:
        """Typed stats + schema fields for one entity type as CSV text."""
        entities = self.entities.list(project.id, entity_type=entity_type, limit=100000)
        schema = schema_for(entity_type)
        typed_keys: list[str] = []
        for e in entities:
            for k in (e.typed_json or {}):
                if k not in typed_keys and not isinstance((e.typed_json or {})[k], (dict, list)):
                    typed_keys.append(k)
        field_paths = [f.path for f in schema.fields]
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["name", "displayName", "race", "faction", *typed_keys, *field_paths])
        for e in entities:
            doc = Document.from_json(e.tree_json)
            t = e.typed_json or {}
            w.writerow([e.name, e.display_name or "", e.race or "", e.faction or "",
                        *[t.get(k, "") for k in typed_keys], *[_fmt(doc.scalar(p)) for p in field_paths]])
        return buf.getvalue()

    # ── helpers ─────────────────────────────────────────────────────────
    def _in_place(self, project: Project) -> bool:
        return not project.output_root or Path(project.output_root).resolve() == Path(project.mod_root).resolve()

    def _target(self, project: Project, rel: str) -> Path:
        root = Path(project.output_root) if project.output_root else Path(project.mod_root)
        return root / rel


def _fmt(v: Any) -> Any:
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, list):
        return " ".join(str(x) for x in v)
    return "" if v is None else v

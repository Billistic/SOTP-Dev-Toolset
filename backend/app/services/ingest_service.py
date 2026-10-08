"""
Scans a project's mod folder and synchronises the database with it.

Entities are hashed so unchanged files are skipped; strings, assets and
Player memberships are rebuilt each run (they are cheap).  Validation runs
at the end so diagnostics always reflect the freshly ingested state.
"""
from __future__ import annotations

import hashlib
import logging
import time
from pathlib import Path
from typing import Any, Callable

from sqlalchemy.orm import Session

from ..dao import AssetDAO, EntityDAO, StringDAO
from ..models import Asset, Entity, GameString, Project
from ..models.project import utcnow
from ..sins import parse
from . import asset_indexer
from .entity_rows import build_children, build_members, populate_entity
from .faction_service import FactionService
from .validation_service import ValidationService

log = logging.getLogger(__name__)
Progress = Callable[[str, int, int], None]

ENTITY_DIR = "GameInfo"
STRING_DIR = "String"
# The game only loads language-named string tables; anything else in String/ is scratch.
LANGUAGES = {"english", "french", "german", "spanish", "italian", "russian", "polish",
             "chinese", "japanese", "korean", "portuguese", "czech", "hungarian"}


class IngestService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)
        self.strings = StringDAO(db)
        self.assets = AssetDAO(db)

    # ── public ──────────────────────────────────────────────────────────
    def ingest(self, project: Project, *, force: bool = False, progress: Progress | None = None) -> dict[str, Any]:
        root = Path(project.mod_root)
        if not root.is_dir():
            raise FileNotFoundError(f"mod root does not exist: {root}")
        t0 = time.time()
        stats = {"added": 0, "updated": 0, "skipped": 0, "removed": 0, "errors": 0, "strings": 0, "assets": 0}

        files = sorted((root / ENTITY_DIR).glob("*.entity")) if (root / ENTITY_DIR).is_dir() else []
        existing = self.entities.paths_for_project(project.id)
        seen: set[str] = set()
        for i, path in enumerate(files):
            rel = _rel(root, path)
            seen.add(rel)
            outcome = self._ingest_entity(project, root, path, existing.get(rel), force)
            stats[outcome] += 1
            if progress and i % 50 == 0:
                progress("entities", i, len(files))
            if i % 200 == 0:
                self.db.flush()

        for rel, entity in existing.items():
            if rel not in seen:
                if entity.is_dirty:
                    entity.source_missing = True      # keep unsaved editor work
                else:
                    self.entities.remove(entity)
                    stats["removed"] += 1
        self.db.flush()

        stats["strings"] = self._ingest_strings(project, root)
        stats["assets"] = self._ingest_assets(project, root, "mod")
        if project.vanilla_root and Path(project.vanilla_root).is_dir():
            stats["assets"] += self._ingest_assets(project, Path(project.vanilla_root), "vanilla")
        self._ingest_memberships(project)
        self.db.flush()
        FactionService(self.db).assign(project.id)
        self._resolve_display_names(project)
        project.last_ingest_at = utcnow()
        self.db.commit()

        if progress:
            progress("validate", 0, 1)
        stats["diagnostics"] = ValidationService(self.db).run(project)
        self.db.commit()
        stats["seconds"] = round(time.time() - t0, 2)
        return stats

    # ── entities ────────────────────────────────────────────────────────
    def _ingest_entity(self, project: Project, root: Path, path: Path, existing: Entity | None, force: bool) -> str:
        raw = path.read_bytes()
        digest = hashlib.md5(raw).hexdigest()
        if existing is not None and not force and existing.file_hash == digest and not existing.source_missing:
            return "skipped"
        if existing is not None and existing.is_dirty and not force:
            return "skipped"  # never clobber unsaved editor work silently
        try:
            doc = parse(raw.decode("utf-8", errors="replace"), str(path))
        except Exception as exc:  # pragma: no cover - parser is total, but stay safe
            log.exception("failed to parse %s", path)
            return "errors"

        entity = existing or Entity(project_id=project.id, source_path=_rel(root, path), file_hash=digest, tree_json={})
        populate_entity(entity, doc, path.stem)
        entity.file_hash = digest
        entity.source_path = _rel(root, path)
        entity.is_dirty = False
        entity.source_missing = False
        entity.written_at = None
        if existing is None:
            self.entities.add(entity)
            self.db.flush()
        self.entities.replace_children(entity, **build_children(doc))
        return "added" if existing is None else "updated"

    # ── strings ─────────────────────────────────────────────────────────
    def _ingest_strings(self, project: Project, root: Path) -> int:
        folder = root / STRING_DIR
        total = 0
        if not folder.is_dir():
            return 0
        for path in sorted(folder.glob("*.str")):
            if path.stem.lower() not in LANGUAGES:
                continue
            doc = parse(path.read_text(encoding="utf-8-sig", errors="replace"), str(path))
            rows: dict[str, GameString] = {}
            for info in doc.root.all("StringInfo"):
                sid, value = info.scalar("ID"), info.scalar("Value")
                if not sid:
                    continue
                if sid in rows:
                    rows[sid].duplicate_count += 1
                    continue
                rows[sid] = GameString(string_id=str(sid), value=str(value or ""), original_value=str(value or ""),
                                       source_file=_rel(root, path), line_no=(info.line_no or 0) + 1, duplicate_count=1)
            self.strings.replace_all(project.id, list(rows.values()), _rel(root, path))
            total += len(rows)
        return total

    # ── assets ──────────────────────────────────────────────────────────
    def _ingest_assets(self, project: Project, root: Path, source: str) -> int:
        rows = list(asset_indexer.index_root(root, include_definitions=(source == "vanilla")))
        self.assets.replace_source(project.id, source, rows)
        return len(rows)

    # ── player memberships ──────────────────────────────────────────────
    def _ingest_memberships(self, project: Project) -> None:
        from ..sins import Document
        for player in self.entities.list(project.id, entity_type="Player"):
            doc = Document.from_json(player.tree_json)
            self.entities.replace_members(project.id, player, build_members(doc))

    def _resolve_display_names(self, project: Project) -> None:
        from ..sins.schemas import schema_for
        names = self.strings.value_map(project.id)
        for e in self.entities.all_for_project(project.id):
            key = schema_for(e.entity_type).name_key
            sid = _tree_scalar(e.tree_json, key) if key else None
            e.display_name = names.get(sid) if sid else None


def _rel(root: Path, path: Path) -> str:
    return str(path.relative_to(root)).replace("\\", "/")


def _tree_scalar(tree: dict, key: str) -> str | None:
    for child in tree.get("root", []):
        if child.get("k") == key and "v" in child:
            v = child["v"]
            return v[1:-1] if v.startswith('"') else v
    return None

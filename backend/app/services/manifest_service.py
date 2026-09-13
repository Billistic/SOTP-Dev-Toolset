"""
entity.manifest is the game's load list: only the ``.entity`` files named in it are
read from GameInfo (anything listed but absent falls through to the base game).
The tool edits it in place - same order, same line endings, nothing dropped that it
did not add - so hand-curated entries and vanilla fall-throughs survive.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..dao import AssetDAO, EntityDAO
from ..models import Entity, Project

_ENTRY = re.compile(r'^(\s*)entityName\s+"([^"]*)"(.*)$')   # group 3: stray text after the quote (seen in the wild)
_COUNT = re.compile(r"^(\s*)entityNameCount\s+\d+\s*$")


class EntityManifest:
    """One ``entity.manifest`` file held as lines so edits keep everything else byte-for-byte."""

    FILE = "entity.manifest"

    def __init__(self, text: str, path: Path | None = None):
        self.path = path
        self.newline = "\r\n" if "\r\n" in text else "\n"
        self.trailing_newline = text.endswith(("\n", "\r")) or not text.strip()
        self.lines = text.replace("\r\n", "\n").rstrip("\n").split("\n") if text.strip() else ["TXT", "entityNameCount 0"]

    @classmethod
    def load(cls, root: Path) -> "EntityManifest":
        path = root / cls.FILE
        text = path.read_bytes().decode("utf-8-sig", errors="replace") if path.is_file() else ""   # bytes: keep CRLF
        return cls(text, path)

    # ── queries ─────────────────────────────────────────────────────────
    def names(self) -> list[str]:
        return [m.group(2) for line in self.lines if (m := _ENTRY.match(line))]

    def has(self, filename: str) -> bool:
        low = filename.lower()
        return any(n.lower() == low for n in self.names())

    def malformed(self) -> list[tuple[int, str]]:
        """(1-based line, text) of entries with junk after the closing quote - the game may misread them."""
        return [(i + 1, line) for i, line in enumerate(self.lines) if (m := _ENTRY.match(line)) and m.group(3).strip()]

    # ── edits ───────────────────────────────────────────────────────────
    def add(self, filename: str) -> bool:
        """Append an entry (after the last one, matching its indentation); False when already listed."""
        if self.has(filename):
            return False
        last = max((i for i, line in enumerate(self.lines) if _ENTRY.match(line)), default=None)
        indent = _ENTRY.match(self.lines[last]).group(1) if last is not None else ""
        at = last + 1 if last is not None else len(self.lines)
        self.lines.insert(at, f'{indent}entityName "{filename}"')
        return True

    def remove(self, filename: str) -> bool:
        low = filename.lower()
        before = len(self.lines)
        self.lines = [line for line in self.lines if not ((m := _ENTRY.match(line)) and m.group(2).lower() == low)]
        return len(self.lines) != before

    # ── output ──────────────────────────────────────────────────────────
    def text(self) -> str:
        count = len(self.names())
        lines = list(self.lines)
        idx = next((i for i, line in enumerate(lines) if _COUNT.match(line)), None)
        if idx is None:   # no count line: put one after the TXT header
            lines.insert(1 if lines and lines[0].strip().startswith("TXT") else 0, f"entityNameCount {count}")
        else:
            lines[idx] = f"{_COUNT.match(lines[idx]).group(1)}entityNameCount {count}"
        return self.newline.join(lines) + (self.newline if self.trailing_newline else "")

    def save(self, path: Path | None = None) -> Path:
        target = path or self.path
        if target is None:
            raise ValueError("no path to save the manifest to")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(self.text(), encoding="utf-8", newline="")
        return target


class ManifestService:
    """Keeps entity.manifest in step with files the tool writes and deletes."""

    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)
        self.assets = AssetDAO(db)

    # ── per-entity ──────────────────────────────────────────────────────
    def add(self, project: Project, entity: Entity) -> bool:
        m = self._open(project)
        changed = m.add(_filename(entity))
        if changed:
            m.save(self._target(project))
        return changed

    def remove(self, project: Project, entity: Entity) -> bool:
        m = self._open(project)
        changed = m.remove(_filename(entity))
        if changed:
            m.save(self._target(project))
        return changed

    def listed(self, project: Project, entity: Entity) -> bool:
        return self._open(project).has(_filename(entity))

    # ── whole project ───────────────────────────────────────────────────
    def status(self, project: Project) -> dict[str, Any]:
        """Listed entries vs. entities: what the game would load, what it cannot find, what is left out."""
        m = self._open(project)
        listed = m.names()
        low = {n.lower() for n in listed}
        ents = self.entities.all_for_project(project.id)
        on_disk = {_filename(e).lower(): e for e in ents if not e.source_missing}
        vanilla = self.assets.lookup(project.id).get("entity", {})
        missing = [n for n in listed if n.lower() not in on_disk and n.lower().rsplit(".", 1)[0] not in vanilla]
        unlisted = sorted(e.name for f, e in on_disk.items() if f not in low)
        return {"path": str(m.path), "count": len(listed), "missing": missing, "unlisted": unlisted,
                "unlistedWritten": sorted(e.name for f, e in on_disk.items() if f not in low and e.written_at is not None),
                "vanillaIndexed": bool(project.vanilla_root and Path(project.vanilla_root).is_dir())}

    def sync(self, project: Project) -> dict[str, Any]:
        """
        Non-destructive reconciliation: add entities the tool has written that are not listed; drop entries
        whose file is gone and that the base game does not supply either (only when vanilla is indexed, so a
        fall-through is never mistaken for a dead entry).  Hand-written, unlisted files are left alone.
        """
        m = self._open(project)
        ents = self.entities.all_for_project(project.id)
        added = [e.name for e in ents if not e.source_missing and e.written_at is not None and m.add(_filename(e))]
        removed: list[str] = []
        if project.vanilla_root and Path(project.vanilla_root).is_dir():
            on_disk = {_filename(e).lower() for e in ents if not e.source_missing}
            vanilla = self.assets.lookup(project.id).get("entity", {})
            for name in m.names():
                if name.lower() not in on_disk and name.lower().rsplit(".", 1)[0] not in vanilla and m.remove(name):
                    removed.append(name)
        path = m.save(self._target(project)) if added or removed else m.path
        return {"written": str(path), "added": added, "removed": removed, "count": len(m.names())}

    # ── helpers ─────────────────────────────────────────────────────────
    def _target(self, project: Project) -> Path:
        root = Path(project.output_root) if project.output_root else Path(project.mod_root)
        return root / EntityManifest.FILE

    def _open(self, project: Project) -> EntityManifest:
        """The output root's manifest once one exists there, otherwise the mod's (so exports start from it)."""
        target = self._target(project)
        m = EntityManifest.load(target.parent) if target.is_file() else EntityManifest.load(Path(project.mod_root))
        m.path = target
        return m


def _filename(entity: Entity) -> str:
    return entity.source_path.rsplit("/", 1)[-1]

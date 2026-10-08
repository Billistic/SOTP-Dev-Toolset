"""
Applies editor changes to an entity's tree, re-derives its rows and
re-validates it.  Edits live in the database (``is_dirty``) until the
export service writes them back to disk.
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ..dao import AssetDAO, EntityDAO, StringDAO
from ..models import Entity, GameString, Project
from ..models.project import utcnow
from ..sins import Document, Node, parse
from ..sins.schemas import schema_for
from ..sins.schemas.faction import strip_faction_suffix
from ..sins.schemas.references import STRING, classify_key
from ..sins.writer import sync_counts, write
from .entity_rows import build_children, populate_entity
from .faction_service import FactionService
from .manifest_service import ManifestService
from .validation_service import ValidationService

PRIMARY_STR = "String/English.str"
TRASH_DIR = ".sotp-trash"


class EditError(ValueError):
    pass


class EditService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)
        self.strings = StringDAO(db)
        self.assets = AssetDAO(db)
        self.validation = ValidationService(db)
        self.created_strings: list[GameString] = []   # filled by the last apply()/create()

    # ── field-level edits ───────────────────────────────────────────────
    def apply(self, project: Project, entity: Entity, changes: list[dict[str, Any]], *, create_strings: bool = True) -> Entity:
        """
        ``changes`` items: {"op": "set", "path": ..., "value": ...}
                         | {"op": "setRaw", "path": ..., "raw": ...}
                         | {"op": "add", "parent": path|"", "key": ..., "value": ..., "after": path|None}
                         | {"op": "remove", "path": ...}
                         | {"op": "clone", "path": ...}                      duplicate a block right after itself
                         | {"op": "move", "path": ..., "offset": -1 | 1}     reorder among same-key siblings
                         | {"op": "insertText", "parent": path|"", "text": ..., "after": path|None, "afterLast": [key, ...]}
        With ``create_strings`` a string-ID field pointed at an unknown ID gets a placeholder string row.
        """
        doc = Document.from_json(entity.tree_json)
        self.created_strings = []
        touched: list[Node] = []
        for ch in changes:
            op = ch.get("op", "set")
            if op == "set":
                node = self._require(doc, ch["path"])
                if node.is_block:
                    raise EditError(f"'{ch['path']}' is a block, not a value")
                node.set_value(ch["value"])
                touched.append(node)
            elif op == "setRaw":
                node = self._require(doc, ch["path"])
                node.set_raw(str(ch["raw"]))
                touched.append(node)
            elif op == "add":
                parent = doc.root if not ch.get("parent") else self._require(doc, ch["parent"])
                after = doc.get_path(ch["after"]) if ch.get("after") else None
                touched.append(parent.add_child(ch["key"], ch.get("value"), after=after, raw=ch.get("raw")))
            elif op == "remove":
                self._require(doc, ch["path"]).remove()
            elif op == "clone":
                node = self._require(doc, ch["path"])
                node.parent.insert(node.clone(), after=node)
            elif op == "move":
                if not self._require(doc, ch["path"]).move(int(ch.get("offset", 0))):
                    raise EditError(f"cannot move '{ch['path']}' by {ch.get('offset')}")
            elif op == "insertText":
                parent = doc.root if not ch.get("parent") else self._require(doc, ch["parent"])
                after = doc.get_path(ch["after"]) if ch.get("after") else None
                for key in ch.get("afterLast") or []:   # first key with a live child wins; insert after its last one
                    peers = parent.all(key)
                    if peers:
                        after = peers[-1]
                        break
                for new in reversed(_fragment(str(ch["text"]))):   # keep fragment order when inserting after
                    parent.insert(new, after=after)
                    touched.extend(n for _, n in new.walk() if not n.is_block)
            else:
                raise EditError(f"unknown op '{op}'")
        sync_counts(doc.root)
        if create_strings:
            for node in touched:
                self._ensure_string(project, node)
        return self._store(project, entity, doc)

    # ── raw-text edits ──────────────────────────────────────────────────
    def replace_text(self, project: Project, entity: Entity, text: str) -> Entity:
        doc = parse(text, entity.source_path)
        if doc.entity_type is None:
            raise EditError("text has no entityType")
        return self._store(project, entity, doc, raw_lines=True)

    def create(self, project: Project, name: str, text: str | None = None, *, template: str | None = None,
               own_strings: bool = False) -> Entity:
        """New entity from raw text or as a copy of ``template``; ``own_strings`` gives it fresh name/desc string IDs."""
        if not re.fullmatch(r"[A-Za-z0-9_\-.]+", name or ""):
            raise EditError("entity names may only contain letters, digits, '_', '-' and '.'")
        if self.entities.by_name(project.id, name):
            raise EditError(f"entity '{name}' already exists")
        self.created_strings = []
        if template:
            src = self.entities.by_name(project.id, template)
            if src is None:
                raise EditError(f"template '{template}' not found")
            text = write(Document.from_json(src.tree_json), "preserve")
        if not text:
            raise EditError("either text or template is required")
        doc = parse(text)
        if doc.entity_type is None:
            raise EditError("text has no entityType")
        if own_strings:
            self._assign_own_strings(project, doc, name)
            doc = parse(write(doc, "preserve"))   # re-parse so raw lines match the edited values
        entity = Entity(project_id=project.id, source_path=f"GameInfo/{name}.entity", file_hash="", tree_json={})
        populate_entity(entity, doc, name)
        entity.is_dirty = True
        entity.source_missing = True
        self.entities.add(entity)
        self.db.flush()
        self.entities.replace_children(entity, **build_children(doc))
        self.validation.run_entity(project, entity)
        self.db.commit()
        return entity

    def delete(self, project: Project, entity: Entity, *, move_file: bool = True) -> dict[str, Any]:
        """Remove the entity; its file (if any) is moved to ``.sotp-trash`` rather than destroyed."""
        moved: str | None = None
        path = Path(project.mod_root) / entity.source_path
        if move_file and path.is_file():
            dest = Path(project.mod_root) / TRASH_DIR / entity.source_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                dest = dest.with_name(f"{dest.stem}.{utcnow().strftime('%Y%m%d%H%M%S')}{dest.suffix}")
            shutil.move(str(path), str(dest))
            moved = str(dest)
            ManifestService(self.db).remove(project, entity)   # otherwise the game would look for a file that is gone
        name = entity.name
        self.entities.remove(entity)
        self.db.flush()
        self.validation.run(project)   # referencing entities now have dangling links
        self.db.commit()
        return {"deleted": name, "movedTo": moved}

    def revert(self, project: Project, entity: Entity) -> Entity:
        """Discard database edits and re-read the file from disk."""
        from pathlib import Path
        path = Path(project.mod_root) / entity.source_path
        if not path.is_file():
            raise EditError("source file does not exist; nothing to revert to")
        doc = parse(path.read_bytes().decode("utf-8", errors="replace"), str(path))
        entity.is_dirty = False
        self._store(project, entity, doc, mark_dirty=False)
        return entity

    def render(self, entity: Entity, mode: str = "preserve") -> str:
        return write(Document.from_json(entity.tree_json), mode)

    # ── internals ───────────────────────────────────────────────────────
    def _ensure_string(self, project: Project, node: Node) -> None:
        """Create a placeholder string row when a string-ID field points at an ID nobody defines."""
        if node.is_block or node.kind != "string" or not node.value:
            return
        parent_key = node.parent.key if node.parent is not None else None
        if classify_key(node.key, parent_key) != STRING:
            return
        sid = str(node.value)
        if self.strings.get_by_id(project.id, sid) or sid.lower() in self.assets.lookup(project.id).get("string", {}):
            return
        self.created_strings.append(self.strings.upsert(project.id, sid, humanize(sid), PRIMARY_STR))

    def _assign_own_strings(self, project: Project, doc: Document, name: str) -> None:
        schema = schema_for(doc.entity_type or "")
        stem = strip_faction_suffix(name)
        for key, suffix in ((schema.name_key, "Name"), (schema.desc_key, "Desc")):
            node = doc.get_path(key) if key else None
            if node is None or node.is_block:
                continue
            node.set_value(f"{stem}_{suffix}")
            self._ensure_string(project, node)

    def _require(self, doc: Document, path: str):
        node = doc.get_path(path)
        if node is None:
            raise EditError(f"no node at '{path}'")
        return node

    def _store(self, project: Project, entity: Entity, doc: Document, *, mark_dirty: bool = True, raw_lines: bool = False) -> Entity:
        # Re-parse the rendered text so line numbers / raw lines are consistent for the next edit.
        text = write(doc, "preserve")
        fresh = parse(text, entity.source_path)
        populate_entity(entity, fresh, entity.name)
        FactionService(self.db).assign(entity.project_id, only=[entity])   # keep the player-derived faction
        if mark_dirty:
            entity.is_dirty = True
        entity.updated_at = utcnow()
        self.entities.replace_children(entity, **build_children(fresh))
        self.db.flush()
        self.validation.run_entity(project, entity)
        self.db.commit()
        return entity


def _fragment(text: str) -> list[Node]:
    """Parse a snippet of Sins text (no header needed) into fresh top-level nodes."""
    doc = parse("TXT\n" + text.strip("\n") + "\n")
    return [c.clone() for c in doc.root.live_children()]


def humanize(string_id: str) -> str:
    """'Frigate_UNSC_Able_Name' -> 'Frigate UNSC Able': a readable placeholder until the modder writes the real text."""
    words = [w for w in re.split(r"[_\s]+", string_id) if w]
    if len(words) > 1 and words[-1].lower() in ("name", "desc", "description", "title"):
        words = words[:-1]
    return " ".join(words) or string_id

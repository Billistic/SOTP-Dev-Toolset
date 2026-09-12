"""
Turns a parsed ``Document`` into ORM rows (entity columns + child tables).

Kept separate from the ingest orchestration so the edit service can rebuild
rows for a single entity after an in-editor change.
"""
from __future__ import annotations

from typing import Any

from ..models import Entity, EntityField, FactionMember, Prerequisite, Reference, ResearchModifier, Weapon
from ..sins import Document
from ..sins.structure import REPEATABLE
from ..sins.schemas import category_for, extract_references, extract_typed
from ..sins.schemas.effects import extract_player_members
from ..sins.schemas.faction import detect
from ..sins.schemas.research import extract_modifiers, extract_prerequisites
from ..sins.schemas.units import extract_weapons

_NUMERIC = ("int", "float")


def populate_entity(entity: Entity, doc: Document, name: str) -> None:
    """Fill the scalar columns of ``entity`` from ``doc``."""
    et = doc.entity_type or "Unknown"
    race, faction = detect(name)
    typed = extract_typed(doc)
    entity.name = name
    entity.entity_type = et
    entity.category = category_for(et)
    entity.race = race
    entity.faction = faction
    entity.role = typed.get("role") or typed.get("stat_count_type") or typed.get("field")
    entity.fmt = doc.header.fmt
    entity.archive_version = doc.header.archive_version
    entity.line_count = len(doc.raw_lines)
    entity.tree_json = doc.to_json(include_raw=True)
    entity.typed_json = typed


def build_children(doc: Document) -> dict[str, list[Any]]:
    fields = [EntityField(path=path, key=node.base_key, value_text=node.raw_value or "",
                          value_num=_num(node), value_kind=node.kind or "")
              for path, node in doc.root.walk(REPEATABLE) if not node.is_block]
    weapons = [Weapon(**w) for w in extract_weapons(doc)] if doc.root.get("Weapon") else []
    prereqs = [Prerequisite(**p) for p in extract_prerequisites(doc)]
    modifiers = [ResearchModifier(**m) for m in extract_modifiers(doc)] if doc.entity_type == "ResearchSubject" else []
    refs = [Reference(path=r.path, key=r.key, kind=r.kind, target=r.target, target_lower=r.target.lower())
            for r in extract_references(doc)]
    return {"fields": fields, "weapons": weapons, "prerequisites": prereqs, "modifiers": modifiers, "references": refs}


def build_members(doc: Document) -> list[FactionMember]:
    return [FactionMember(slot=m["slot"], page=m["page"], ordinal=m["ordinal"], member_name=m["name"])
            for m in extract_player_members(doc)]


def _num(node) -> float | None:
    if node.kind in _NUMERIC:
        try:
            return float(node.value)
        except (TypeError, ValueError):
            return None
    if node.kind == "bool":
        return 1.0 if node.value else 0.0
    return None

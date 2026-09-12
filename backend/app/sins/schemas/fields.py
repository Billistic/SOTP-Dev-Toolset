"""
Field specifications: the metadata layer that turns a raw tree into forms,
typed analytics rows and reference checks.

A ``FieldSpec`` describes one logical field of an entity type.  ``path`` uses
the same syntax as ``Node.get_path``; ``[*]`` marks a repeated block.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from ..document import Document, Node

# UI groups, in display order.
GROUPS = ["Identity", "Economy", "Durability", "Mobility", "Combat", "Fleet",
          "Research", "Planet", "Module", "Squad", "Ability", "Visual", "Audio", "Text", "AI", "Other"]


@dataclass(frozen=True, slots=True)
class FieldSpec:
    path: str
    label: str
    group: str
    kind: str = "float"           # float | int | bool | string | enum | ref | color | array | stat
    ref: str | None = None        # reference kind when kind == 'ref'
    enum: str | None = None       # enum registry name when kind == 'enum'
    unit: str | None = None
    balance: bool = False         # a tuning knob worth comparing across peers
    help: str | None = None
    when: str | None = None       # only meaningful for this variant (e.g. weaponType == "Beam")

    def to_dict(self) -> dict[str, Any]:
        return {"path": self.path, "label": self.label, "group": self.group, "kind": self.kind,
                "ref": self.ref, "enum": self.enum, "unit": self.unit, "balance": self.balance, "help": self.help,
                "when": self.when}


@dataclass(slots=True)
class EntitySchema:
    entity_type: str
    category: str                          # ship | research | module | planet | squad | buff | ability | player | other
    fields: list[FieldSpec] = field(default_factory=list)
    required: tuple[str, ...] = ()        # top-level keys that must exist
    name_key: str = "NameStringID"
    desc_key: str = "DescriptionStringID"

    def to_dict(self) -> dict[str, Any]:
        return {"entityType": self.entity_type, "category": self.category,
                "fields": [f.to_dict() for f in self.fields], "required": list(self.required),
                "nameKey": self.name_key, "descKey": self.desc_key}


def stat(node: Node | Document, key: str, default: float | None = None) -> float | None:
    """
    Read a stat that is either a bare scalar (``MaxHullPoints 350.0``) or a
    ``StartValue`` block (``MaxHullPoints / StartValue 600.0``); casing of the
    first letter varies between entity types, so both are tried.
    """
    root = node.root if isinstance(node, Document) else node
    for k in (key, key[:1].lower() + key[1:], key[:1].upper() + key[1:]):
        n = root.get(k)
        if n is None:
            continue
        if n.is_block:
            v = n.scalar("StartValue")
        else:
            v = n.value
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return default


def stat_growth(node: Node | Document, key: str) -> float | None:
    root = node.root if isinstance(node, Document) else node
    n = root.get(key)
    if n is None or not n.is_block:
        return None
    v = n.scalar("ValueIncreasePerLevel")
    return float(v) if isinstance(v, (int, float)) else None


def cost(node: Node | Document, key: str) -> dict[str, float]:
    root = node.root if isinstance(node, Document) else node
    n = root.get(key)
    out = {"credits": 0.0, "metal": 0.0, "crystal": 0.0}
    if n is None:
        return out
    for k in out:
        v = n.scalar(k)
        if isinstance(v, (int, float)):
            out[k] = float(v)
    return out


def level_table(node: Node | None) -> dict[int, float]:
    """``Level:0 30.0`` style tables -> {0: 30.0, ...}."""
    if node is None:
        return {}
    out: dict[int, float] = {}
    for suffix, child in node.indexed("Level").items():
        try:
            out[int(suffix)] = float(child.value)
        except (TypeError, ValueError):
            continue
    return out


def specs(rows: Iterable[tuple]) -> list[FieldSpec]:
    """Compact constructor: rows of (path, label, group, kind, **extras-dict)."""
    out: list[FieldSpec] = []
    for row in rows:
        path, label, group, kind = row[:4]
        extra = row[4] if len(row) > 4 else {}
        out.append(FieldSpec(path, label, group, kind, **extra))
    return out

"""
The Sins entity grammar: which keys each entityType may carry, in what order, with what
kind of value, which enum values are legal and which sub-fields a given enum value implies.

Loaded from the XML definitions in ``defs/`` (see the README there), filtered to the
Rebellion view.  ``Grammar.layout(doc)`` walks a parsed document alongside its grammar and
returns the expected fields section by section - each with its presence, value, legal
options, help and a text template for adding it - which drives the complete form view,
the "add missing field" action and the unknown-key / illegal-enum diagnostics.
"""
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field as dc_field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator

from .document import Document, Node

DEFS_DIR = Path(__file__).resolve().parent / "defs"
_EXCLUDED_VERSIONS = {"NotRebellion", "EntrenchmentOnly", "DiplomacyOnly", "NotDiplomacyOrRebellion"}
_LEGACY_VERSIONS = {"Vanilla"}   # superseded before Rebellion (MeshName -> MeshNameInfo...); shown only when present

# validation attribute -> (field kind, reference kind)
_VALIDATION: dict[str, tuple[str, str | None]] = {
    "Boolean": ("bool", None), "Integer": ("int", None), "Decimal": ("float", None),
    "StringInfo": ("ref", "string"), "Brush": ("ref", "brush"), "Mesh": ("ref", "mesh"), "Texture": ("ref", "texture"),
    "Sound": ("ref", "sound"), "SoundFile": ("ref", "ogg"), "Entity": ("ref", "entity"), "Research": ("ref", "entity"),
    "Particle": ("ref", "particle"), "Explosion": ("ref", "explosion"),
    "Color": ("color", None), "Position": ("position", None), "Orientation": ("orientation", None),
    "Coordinate": ("coordinate", None), "Theme": ("string", None), "GalaxyDesign": ("string", None),
    "Simple": ("string", None), "Any": ("string", None), "Structure": ("string", None),
}
# small shared blocks that read better as one row of inputs than as their own tile
INLINE_STRUCTURES = {"GenericLevel": "levels", "LevelIncrease": "levelinc", "Cost": "cost"}


# ── grammar model ───────────────────────────────────────────────────────────

@dataclass(slots=True)
class GField:
    name: str
    kind: str = "string"                 # bool | int | float | string | enum | ref | color | position | ...
    ref: str | None = None
    enum: str | None = None              # element_rule name the values come from
    values: tuple[str, ...] = ()
    required: bool = False
    help: str | None = None
    legacy: bool = False


@dataclass(slots=True)
class GCondition:
    values: tuple[str, ...]
    items: list[Any] = dc_field(default_factory=list)


@dataclass(slots=True)
class GConditionField:
    name: str
    conditions: list[GCondition] = dc_field(default_factory=list)
    required: bool = False
    help: str | None = None
    legacy: bool = False

    @property
    def values(self) -> tuple[str, ...]:
        return tuple(v for c in self.conditions for v in c.values)

    def branch(self, value: str | None) -> GCondition | None:
        for c in self.conditions:
            if value in c.values:
                return c
        return None


@dataclass(slots=True)
class GStructure:
    name: str
    items: list[Any] = dc_field(default_factory=list)
    required: bool = False
    help: str | None = None
    legacy: bool = False


@dataclass(slots=True)
class GStructureRef:
    name: str
    type: str
    required: bool = False
    help: str | None = None
    legacy: bool = False


@dataclass(slots=True)
class GIterative:
    name: str                            # the count key (NumWeapons, numInstantActions...)
    item: Any = None                     # what repeats: GField | GStructure | GStructureRef | GConditionField
    limit: int | None = None
    help: str | None = None
    legacy: bool = False


class Grammar:
    def __init__(self) -> None:
        self.structures: dict[str, GStructure] = {}
        self.enums: dict[str, tuple[str, ...]] = {}
        self.condition_fields: dict[str, GConditionField] = {}

    # ── loading ─────────────────────────────────────────────────────────
    @classmethod
    def load(cls, folder: Path = DEFS_DIR) -> "Grammar":
        g = cls()
        extensions: list[ET.Element] = []
        if not folder.is_dir():   # tables not shipped: every type is "unknown" and the form falls back to the curated groups
            logging.getLogger(__name__).warning("entity grammar folder missing: %s", folder)
            return g
        for path in sorted(folder.glob("*.xml")):
            root = ET.parse(path).getroot()
            for el in root:
                tag = _tag(el)
                if _skip(el):
                    continue
                if tag == "structure" and (el.get("extend") or "").lower() == "true":
                    extensions.append(el)
                elif tag == "structure":
                    st = g._structure(el)
                    g.structures.setdefault(st.name, st)
                elif tag == "element_rule":
                    g.enums[el.get("name")] = _values(el)
                elif tag == "condition_field":
                    g.condition_fields[el.get("name")] = g._condition_field(el)
        for el in extensions:   # additions to existing structures (see defs/zz_rebellion_1_8.xml)
            g._extend(el)
        return g

    def _extend(self, el: ET.Element) -> None:
        """Insert the element's items into every structure of that name, each after its ``after`` key (or at the end)."""
        targets = [st for st in self._all_structures() if st.name == el.get("name")]
        for c in el:
            if _tag(c) in ("helpText", "value") or _skip(c):
                continue
            new_items = self._items(_wrap(c))
            for st in targets:
                for item in new_items:
                    at = next((i + 1 for i, x in enumerate(st.items) if getattr(x, "name", None) == c.get("after")), len(st.items))
                    st.items.insert(at, item)

    def _all_structures(self) -> Iterator[GStructure]:
        """Every GStructure in the grammar, nested ones included (gameEventData lives inside Player)."""
        seen: set[int] = set()

        def visit(items: list[Any]) -> Iterator[GStructure]:
            for it in items:
                if isinstance(it, GStructure):
                    if id(it) not in seen:
                        seen.add(id(it))
                        yield it
                        yield from visit(it.items)
                elif isinstance(it, GIterative) and it.item is not None:
                    yield from visit([it.item])
                elif isinstance(it, GConditionField):
                    for cond in it.conditions:
                        yield from visit(cond.items)

        for st in list(self.structures.values()):
            if id(st) not in seen:
                seen.add(id(st))
                yield st
                yield from visit(st.items)
        for cf in list(self.condition_fields.values()):
            for cond in cf.conditions:
                yield from visit(cond.items)

    def _items(self, el: ET.Element) -> list[Any]:
        out: list[Any] = []
        for c in el:
            tag = _tag(c)
            if tag in ("helpText", "value") or _skip(c):
                continue
            if tag == "field":
                out.append(self._field(c))
            elif tag == "structure":
                out.append(self._structure(c))
            elif tag == "structure_reference":
                out.append(GStructureRef(c.get("name"), c.get("type") or c.get("name"), _req(c), _help(c), _legacy(c)))
            elif tag == "iterative_field":
                inner = self._items(c)
                out.append(GIterative(c.get("name"), inner[0] if inner else None, int(c.get("limit")) if c.get("limit") else None, _help(c), _legacy(c)))
            elif tag == "condition_field":
                out.append(self._condition_field(c))
            elif tag == "condition_reference":
                out.append(GConditionRefPlaceholder(c.get("name"), c.get("type") or c.get("name"), _req(c)))
        return out

    def _structure(self, el: ET.Element) -> GStructure:
        return GStructure(el.get("name"), self._items(el), _req(el), _help(el), _legacy(el))

    def _condition_field(self, el: ET.Element) -> GConditionField:
        cf = GConditionField(el.get("name"), required=_req(el), help=_help(el), legacy=_legacy(el))
        for c in el:
            if _tag(c) != "condition" or _skip(c):
                continue
            values = tuple([c.get("value")] if c.get("value") else []) + _values(c)
            cf.conditions.append(GCondition(values, self._items(c)))
        return cf

    def _field(self, el: ET.Element) -> GField:
        f = GField(el.get("name"), required=_req(el), help=_help(el), legacy=_legacy(el))
        kind, ref = _VALIDATION.get(el.get("validation") or "", ("string", None))
        f.kind, f.ref = kind, ref
        inline = _values(el) or tuple(v.strip() for v in (el.get("values") or "").split(",") if v.strip())
        if inline:
            f.kind, f.values = "enum", inline
        f.enum = el.get("type")   # resolved lazily: an element_rule (enum) or a top-level condition_field
        return f

    # ── resolution ──────────────────────────────────────────────────────
    def resolve(self, item: Any) -> Any:
        """Fields typed by name become enums or condition fields; references become structures."""
        if isinstance(item, GField):
            key = item.enum or item.name
            if key in self.condition_fields and item.kind in ("string", "enum") and not item.values:
                cf = self.condition_fields[key]
                return GConditionField(item.name, cf.conditions, item.required or cf.required, item.help or cf.help, item.legacy)
            if item.kind != "enum" and key in self.enums:
                item = GField(item.name, "enum", None, key, self.enums[key], item.required, item.help, item.legacy)
            elif item.kind == "enum" and not item.values and key in self.enums:
                item.values = self.enums[key]
            return item
        if isinstance(item, GConditionRefPlaceholder):
            cf = self.condition_fields.get(item.type)
            return GConditionField(item.name, cf.conditions if cf else [], item.required) if cf else GField(item.name, required=item.required)
        return item

    def structure_of(self, ref: GStructureRef | GStructure) -> GStructure | None:
        if isinstance(ref, GStructure):
            return ref
        return self.structures.get(ref.type) or self.structures.get(ref.name)

    def entity(self, entity_type: str | None) -> GStructure | None:
        return self.structures.get(entity_type or "")

    # ── layout of one document ──────────────────────────────────────────
    def layout(self, doc: Document) -> dict[str, Any]:
        """Sections of expected fields for ``doc`` (see module docstring); empty when the type is unknown."""
        st = self.entity(doc.entity_type)
        if st is None:
            return {"entityType": doc.entity_type, "known": False, "sections": []}
        walker = _Walker(self)
        root = walker.section("", "", st.name, required=True, present=True, help=st.help)
        walker.walk(st.items, doc.root, "", root)
        return {"entityType": doc.entity_type, "known": True, "sections": walker.sections}

    def node_kinds(self, doc: Document) -> dict[int, str]:
        """id(node) -> reference kind for every value the grammar knows to be a reference (string, brush, entity...)."""
        st = self.entity(doc.entity_type)
        if st is None:
            return {}
        walker = _Walker(self)
        root = walker.section("", "", st.name, required=True, present=True)
        walker.walk(st.items, doc.root, "", root)
        return walker.node_kinds


@dataclass(slots=True)
class GConditionRefPlaceholder:
    name: str
    type: str
    required: bool = False


# ── walking a document against the grammar ─────────────────────────────────

class _Walker:
    """Consumes a block's children in grammar order; leftovers are reported as unknown keys."""

    def __init__(self, g: Grammar):
        self.g = g
        self.sections: list[dict[str, Any]] = []
        self._stack: list[tuple[dict[str, Any], dict[str, list[Node]]]] = []   # (section being filled, unconsumed children)
        self._seen: list[set[str]] = []                                          # keys already consumed per frame
        self._shared: list[set[str]] = []                                        # item keys used by >1 iterative in the current item list
        self.node_kinds: dict[int, str] = {}                                     # id(node) -> ref kind, for the reference extractor

    # ── sections ────────────────────────────────────────────────────────
    def section(self, path: str, parent: str, title: str, *, required: bool, present: bool, subtitle: str | None = None,
                help: str | None = None) -> dict[str, Any]:
        sec = {"id": path or "root", "path": path, "parent": parent, "title": title, "subtitle": subtitle, "help": help,
               "required": required, "present": present, "slots": [], "unknown": []}
        self.sections.append(sec)
        return sec

    @property
    def cur(self) -> dict[str, Any]:
        return self._stack[-1][0]

    def walk(self, items: list[Any], node: Node | None, path: str, sec: dict[str, Any]) -> None:
        """Walk ``items`` against the children of ``node`` (None = absent block), emitting slots into ``sec``."""
        pending = _children_by_key(node) if node is not None else {}
        self._stack.append((sec, pending))
        self._seen.append(set())
        if not path:   # the type discriminator is not part of the grammar tables; keep it first and read-only
            et = self._take("entityType")
            if et is not None:
                sec["slots"].append({"key": "entityType", "path": "entityType", "kind": "string", "ref": None, "options": None, "enum": None,
                                     "required": True, "help": None, "legacy": False, "present": True, "raw": et.raw_value,
                                     "block": False, "template": None, "readonly": True})
        self._walk_items(items, node, path)
        self._stack.pop()
        self._seen.pop()
        for nodes in pending.values():   # anything left in the block is unknown to the grammar
            for n in nodes:
                sec["unknown"].append({"key": n.key, "path": _path_of(n), "raw": n.raw_value, "block": n.is_block,
                                       "children": len(n.live_children())})

    # ── items ───────────────────────────────────────────────────────────
    def _walk_items(self, items: list[Any], node: Node | None, path: str) -> None:
        # researchBoolModifiers / researchFloatModifiers both repeat "researchModifier": such keys are split by the declared counts
        keys = [getattr(self.g.resolve(i.item), "name", None) for i in items if isinstance(i, GIterative) and i.item is not None]
        self._shared.append({k for k in keys if k and keys.count(k) > 1})
        try:
            self._walk_each(items, node, path)
        finally:
            self._shared.pop()

    def _walk_each(self, items: list[Any], node: Node | None, path: str) -> None:
        for raw_item in items:
            item = self.g.resolve(raw_item)
            if isinstance(item, GField):
                self._field(item, path)
            elif isinstance(item, GConditionField):
                self._condition(item, node, path)
            elif isinstance(item, (GStructure, GStructureRef)):
                self._block(item, path)
            elif isinstance(item, GIterative):
                self._iterative(item, node, path)

    def _take(self, key: str) -> Node | None:
        """Pop the next unconsumed child with this key (case-insensitive, trailing colon ignored)."""
        _, pending = self._stack[-1]
        lst = pending.get(_norm(key))
        if not lst:
            return None
        n = lst.pop(0)
        if not lst:
            del pending[_norm(key)]
        self._seen[-1].add(_norm(key))
        return n

    def _absent_ok(self, item: Any) -> bool:
        """An absent legacy item, or a key the grammar lists twice and we already matched, is not worth a slot."""
        return getattr(item, "legacy", False) or _norm(item.name) in self._seen[-1]

    def _peek_count(self, key: str) -> int:
        _, pending = self._stack[-1]
        return len(pending.get(_norm(key), []))

    def _field(self, f: GField, path: str) -> dict[str, Any] | None:
        n = self._take(f.name)
        if n is None and self._absent_ok(f):
            return None
        slot = {
            "key": f.name, "path": _path_of(n) if n is not None else _join(path, f.name), "kind": f.kind, "ref": f.ref,
            "options": list(f.values) if f.kind == "enum" else None, "enum": f.enum, "required": f.required, "help": f.help,
            "legacy": f.legacy, "present": n is not None, "raw": n.raw_value if n is not None else None,
            "block": bool(n is not None and n.is_block), "template": _field_template(f),
        }
        if n is not None and f.kind == "enum" and f.values and _token_text(n) not in f.values:
            slot["invalid"] = True
        if n is not None and f.ref:
            self.node_kinds[id(n)] = f.ref
        self.cur["slots"].append(slot)
        return slot

    def _condition(self, cf: GConditionField, node: Node | None, path: str) -> None:
        n = self._take(cf.name)
        if n is None and self._absent_ok(cf):
            return
        value = _token_text(n) if n is not None else None
        branch = cf.branch(value)
        slot = {
            "key": cf.name, "path": _path_of(n) if n is not None else _join(path, cf.name), "kind": "enum", "ref": None,
            "options": list(cf.values), "enum": cf.name, "required": cf.required, "help": cf.help, "legacy": cf.legacy,
            "present": n is not None, "raw": n.raw_value if n is not None else None, "block": bool(n is not None and n.is_block),
            "template": f'{cf.name} {_enum_default(cf.values)}', "switch": True,
        }
        if n is not None and branch is None:
            slot["invalid"] = True
        self.cur["slots"].append(slot)
        if branch is not None:   # the chosen value's own fields follow in the same section
            self._walk_items(branch.items, node, path)

    def _block(self, item: GStructure | GStructureRef, path: str) -> None:
        st = self.g.structure_of(item)
        n = self._take(item.name)
        if n is None and self._absent_ok(item):
            return
        child_path = _path_of(n) if n is not None else _join(path, item.name)
        inline = INLINE_STRUCTURES.get(st.name) if st is not None else None
        if inline:   # GenericLevel / Cost / LevelIncrease: one compound slot with sub-values
            fields = [f for f in (self.g.resolve(x) for x in (st.items if st else [])) if isinstance(f, GField)]
            kids = _children_by_key(n) if n is not None else {}
            sub = []
            for f in fields:
                lst = kids.get(_norm(f.name)) or []
                c = lst.pop(0) if lst else None
                sub.append({"key": f.name, "path": _path_of(c) if c is not None else _join(child_path, f.name),
                            "present": c is not None, "raw": c.raw_value if c is not None else None, "legacy": f.legacy})
            extra = [c for lst in kids.values() for c in lst]
            self.cur["slots"].append({
                "key": item.name, "path": child_path, "kind": inline, "ref": None, "options": None, "enum": None,
                "required": item.required, "help": item.help, "legacy": item.legacy, "present": n is not None,
                "raw": None, "block": True, "values": sub, "template": self.template_for(item),
                "unknown": [{"key": c.key, "path": _path_of(c), "raw": c.raw_value} for c in extra],
            })
            return
        # a real sub-block: a placeholder slot in the parent plus its own section (even when absent, so it can be added)
        parent = self.cur
        parent["slots"].append({
            "key": item.name, "path": child_path, "kind": "section", "ref": None, "options": None, "enum": None,
            "required": item.required, "help": item.help, "legacy": item.legacy, "present": n is not None, "raw": None,
            "block": True, "template": self.template_for(item),
        })
        sec = self.section(child_path, parent["path"], item.name, required=item.required, present=n is not None,
                           subtitle=_discriminator(n) if n is not None else None, help=item.help or (st.help if st else None))
        self.walk(st.items if st else [], n, child_path, sec)

    def _iterative(self, it: GIterative, node: Node | None, path: str) -> None:
        count_node = self._take(it.name)
        if count_node is None and self._absent_ok(it):
            return
        item = self.g.resolve(it.item) if it.item is not None else None
        item_key = getattr(item, "name", None)
        available = self._peek_count(item_key) if item_key else 0
        declared = count_node.value if count_node is not None and isinstance(count_node.value, int) and not isinstance(count_node.value, bool) else None
        if item_key in self._shared[-1]:   # shared item key: the declared count decides (absent count = none of these)
            occurrences = min(declared, available) if declared is not None else 0
        else:
            occurrences = available
        self.cur["slots"].append({
            "key": it.name, "path": _path_of(count_node) if count_node is not None else _join(path, it.name), "kind": "count",
            "ref": None, "options": None, "enum": None, "required": True, "help": it.help, "legacy": it.legacy,
            "present": count_node is not None, "raw": count_node.raw_value if count_node is not None else None, "block": False,
            "template": f"{it.name} 0", "item": item_key, "limit": it.limit, "occurrences": occurrences,
            "itemTemplate": self.template_for(item) if item is not None else None,
            "mismatch": bool(declared is not None and declared != occurrences),
        })
        if item is None:
            return
        for _ in range(occurrences):
            if isinstance(item, GField):
                self._field(item, path)
            elif isinstance(item, GConditionField):
                self._condition(item, node, path)
            elif isinstance(item, (GStructure, GStructureRef)):
                self._block(item, path)

    # ── templates (text fragments for insertText) ───────────────────────
    def template_for(self, item: Any, depth: int = 0) -> str | None:
        item = self.g.resolve(item)
        ind = "\t" * depth
        if isinstance(item, GField):
            return f"{ind}{_field_template(item)}"
        if isinstance(item, GConditionField):
            first = item.conditions[0] if item.conditions else None
            lines = [f"{ind}{item.name} {_enum_default(item.values)}"]
            for sub in (first.items if first else []):
                t = self.template_for(sub, depth)
                if t:
                    lines.append(t)
            return "\n".join(lines)
        if isinstance(item, (GStructure, GStructureRef)):
            st = self.g.structure_of(item)
            lines = [f"{ind}{item.name}"]
            for sub in (st.items if st else []):
                if getattr(sub, "legacy", False):
                    continue
                t = self.template_for(sub, depth + 1)
                if t:
                    lines.append(t)
            return "\n".join(lines)
        if isinstance(item, GIterative):
            return f"{ind}{item.name} 0"
        return None


# ── helpers ─────────────────────────────────────────────────────────────────

def _wrap(el: ET.Element) -> ET.Element:
    """A throwaway parent so ``_items`` can parse one element."""
    w = ET.Element("wrap")
    w.append(el)
    return w


def _tag(el: ET.Element) -> str:
    return el.tag.split("}")[-1]


def _skip(el: ET.Element) -> bool:
    return (el.get("version") or "") in _EXCLUDED_VERSIONS


def _legacy(el: ET.Element) -> bool:
    return (el.get("version") or "") in _LEGACY_VERSIONS


def _req(el: ET.Element) -> bool:
    return (el.get("required") or "").lower() == "true"


def _help(el: ET.Element) -> str | None:
    text = el.get("help") or ""
    for c in el:
        if _tag(c) == "helpText" and c.text:
            text = (text + "\n" + " ".join(c.text.split())).strip()
    return text or None


def _values(el: ET.Element) -> tuple[str, ...]:
    return tuple((c.text or "").strip() for c in el if _tag(c) == "value" and not _skip(c) and (c.text or "").strip())


def _norm(key: str) -> str:
    return key.rstrip(":").lower()


def _children_by_key(node: Node) -> dict[str, list[Node]]:
    out: dict[str, list[Node]] = {}
    for c in node.live_children():
        out.setdefault(_norm(c.key), []).append(c)
    return out


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


def _path_of(node: Node) -> str:
    """Same convention as Node.walk(): ``key[i]`` only when siblings share the key."""
    parts: list[str] = []
    n: Node | None = node
    while n is not None and n.parent is not None:
        sibs = [c for c in n.parent.live_children() if c.key == n.key]
        parts.append(f"{n.key}[{sibs.index(n)}]" if len(sibs) > 1 else n.key)
        n = n.parent
    return ".".join(reversed(parts))


def _token_text(node: Node | None) -> str | None:
    """The value as the grammar spells it: TRUE/FALSE for booleans, unquoted text otherwise."""
    if node is None or node.is_block:
        return None
    v = node.value
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    return str(v)


def _discriminator(node: Node) -> str | None:
    """A block's first enum-looking child value, used as a section subtitle (instantAction -> ApplyBuffToSelf)."""
    for c in node.live_children():
        if not c.is_block and c.base_key.lower().endswith("type") and isinstance(c.value, str):
            return c.value
    return None


def _enum_default(values: tuple[str, ...]) -> str:
    return f'"{values[0]}"' if values else '""'


def _field_template(f: GField) -> str:
    if f.kind == "bool":
        return f"{f.name} FALSE"
    if f.kind == "int":
        return f"{f.name} 0"
    if f.kind == "float":
        return f"{f.name} 0.000000"
    if f.kind == "enum":
        return f"{f.name} {_enum_default(f.values)}"
    if f.kind == "color":
        return f"{f.name} ffffffff"
    if f.kind in ("position", "coordinate"):
        return f"{f.name} [ 0.000000 , 0.000000 , 0.000000 ]"
    if f.kind == "orientation":
        return f"{f.name} [ 1.000000 , 0.000000 , 0.000000 , 0.000000 , 1.000000 , 0.000000 , 0.000000 , 0.000000 , 1.000000 ]"
    return f'{f.name} ""'


@lru_cache(maxsize=1)
def grammar() -> Grammar:
    return Grammar.load()


def iter_slots(layout: dict[str, Any]) -> Iterator[tuple[dict[str, Any], dict[str, Any]]]:
    for sec in layout["sections"]:
        for slot in sec["slots"]:
            yield sec, slot

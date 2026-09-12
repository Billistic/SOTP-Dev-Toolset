"""
In-memory tree for a Sins text file.

``Node`` is deliberately uniform: scalars, block headers, indexed keys
(``Level:0``, ``DamagePerBank:FRONT``) and key-less vector rows are all nodes.
Children are kept in a list so duplicate keys (``Weapon``, ``sound``) keep
their order — the game reads files as an ordered token stream, so order is the
one thing the writer must never change.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator

from . import values
from .lexer import Header

_PATH_TOKEN = re.compile(r"([^.\[\]]+)(?:\[(\d+)\])?")


class Node:
    __slots__ = ("key", "raw_value", "children", "parent", "line_no", "dirty", "deleted")

    def __init__(self, key: str, raw_value: str | None = None, line_no: int | None = None):
        self.key = key
        self.raw_value = raw_value
        self.children: list[Node] = []
        self.parent: Node | None = None
        self.line_no = line_no          # index into Document.raw_lines; None for new nodes
        self.dirty = False
        self.deleted = False

    # ── identity ────────────────────────────────────────────────────────
    @property
    def base_key(self) -> str:
        return self.key.split(":", 1)[0]

    @property
    def suffix(self) -> str | None:
        """Index part of an indexed key: 'Level:0' -> '0', 'Level:0:' -> '0'."""
        if ":" not in self.key:
            return None
        return self.key.split(":", 1)[1].rstrip(":")

    @property
    def is_block(self) -> bool:
        return self.raw_value is None

    # ── values ──────────────────────────────────────────────────────────
    @property
    def value(self) -> Any:
        return None if self.raw_value is None else values.to_python(self.raw_value)

    @property
    def kind(self) -> str | None:
        return None if self.raw_value is None else values.classify(self.raw_value)

    def set_value(self, new: Any) -> None:
        """Replace the value, keeping the previous token's number formatting."""
        raw = values.from_python(new, like=self.raw_value)
        if raw != self.raw_value:
            self.raw_value = raw
            self.dirty = True

    def set_raw(self, raw: str) -> None:
        if raw != self.raw_value:
            self.raw_value = raw
            self.dirty = True

    # ── navigation ──────────────────────────────────────────────────────
    def live_children(self) -> list[Node]:
        return [c for c in self.children if not c.deleted]

    def get(self, key: str) -> Node | None:
        """First live child whose full key or base key equals ``key``."""
        for c in self.children:
            if not c.deleted and (c.key == key or c.base_key == key):
                return c
        return None

    def all(self, key: str) -> list[Node]:
        return [c for c in self.children if not c.deleted and (c.key == key or c.base_key == key)]

    def indexed(self, base: str) -> dict[str, Node]:
        """Indexed siblings by suffix: indexed('Level') -> {'0': node, '1': node}."""
        return {c.suffix or "": c for c in self.children
                if not c.deleted and c.base_key == base and c.suffix is not None}

    def get_path(self, path: str) -> Node | None:
        """Resolve 'Weapon[1].WeaponEffects.muzzleSounds.sound[0]' style paths."""
        node: Node | None = self
        for m in _PATH_TOKEN.finditer(path):
            if node is None:
                return None
            key, idx = m.group(1), m.group(2)
            matches = node.all(key)
            if not matches:
                return None
            i = int(idx) if idx is not None else 0
            node = matches[i] if i < len(matches) else None
        return node

    def scalar(self, path: str, default: Any = None) -> Any:
        node = self.get_path(path)
        return default if node is None or node.is_block else node.value

    def find(self, pred: Callable[[Node], bool]) -> Iterator[Node]:
        for c in self.children:
            if c.deleted:
                continue
            if pred(c):
                yield c
            yield from c.find(pred)

    def depth(self) -> int:
        """0 for top-level nodes, -1 for the root."""
        d, n = -1, self.parent
        while n is not None:
            d, n = d + 1, n.parent
        return d

    # ── mutation ────────────────────────────────────────────────────────
    def add_child(self, key: str, value: Any = None, *, after: Node | None = None,
                  raw: str | None = None) -> Node:
        """Append (or insert after a sibling) a brand-new node."""
        token = raw if raw is not None else (None if value is None else values.from_python(value))
        child = Node(key, token)
        child.parent = self
        child.dirty = True
        if after is None or after not in self.children:
            self.children.append(child)
        else:
            self.children.insert(self.children.index(after) + 1, child)
        return child

    def remove(self) -> None:
        self.deleted = True

    def clone(self) -> Node:
        """Deep copy as brand-new (dirty, unpositioned) nodes; deleted descendants are dropped."""
        c = Node(self.key, self.raw_value)
        c.dirty = True
        for child in self.children:
            if not child.deleted:
                cc = child.clone()
                cc.parent = c
                c.children.append(cc)
        return c

    def insert(self, node: Node, *, after: Node | None = None) -> Node:
        """Attach an existing (new) subtree as a child, optionally right after a sibling."""
        node.parent = self
        if after is None or after not in self.children:
            self.children.append(node)
        else:
            self.children.insert(self.children.index(after) + 1, node)
        return node

    def move(self, offset: int) -> bool:
        """Swap with the previous (-1) / next (+1) live sibling that shares this base key."""
        if self.parent is None or offset not in (-1, 1):
            return False
        peers = [c for c in self.parent.children if not c.deleted and c.base_key == self.base_key]
        i = peers.index(self)
        if not 0 <= i + offset < len(peers):
            return False
        other = peers[i + offset]
        kids = self.parent.children
        a, b = kids.index(self), kids.index(other)
        kids[a], kids[b] = kids[b], kids[a]
        self.dirty = other.dirty = True
        _mark_dirty(self)
        _mark_dirty(other)
        return True

    # ── traversal helpers ───────────────────────────────────────────────
    def walk(self, repeatable: frozenset[str] = frozenset(), _prefix: str = "") -> Iterator[tuple[str, Node]]:
        """Yield (path, node) for every live descendant in document order."""
        counts: dict[str, int] = {}
        totals: dict[str, int] = {}
        for c in self.children:
            if not c.deleted:
                totals[c.key] = totals.get(c.key, 0) + 1
        for c in self.children:
            if c.deleted:
                continue
            i = counts.get(c.key, 0)
            counts[c.key] = i + 1
            token = f"{c.key}[{i}]" if (totals[c.key] > 1 or c.base_key in repeatable) else c.key
            path = f"{_prefix}.{token}" if _prefix else token
            yield path, c
            if c.children:
                yield from c.walk(repeatable, path)

    def to_json(self) -> dict[str, Any]:
        """Lossless ordered representation for the API: {k, v, c, l}."""
        out: dict[str, Any] = {"k": self.key}
        if self.raw_value is not None:
            out["v"] = self.raw_value
        kids = [c.to_json() for c in self.children if not c.deleted]
        if kids:
            out["c"] = kids
        if self.line_no is not None:
            out["l"] = self.line_no
        if self.dirty:  # edited value must beat the original raw line after a round trip
            out["d"] = True
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any], parent: Node | None = None) -> Node:
        node = cls(data.get("k", ""), data.get("v"), data.get("l"))
        node.parent = parent
        node.dirty = bool(data.get("d"))
        node.children = [cls.from_json(c, node) for c in data.get("c", [])]
        return node

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Node({self.key!r}, {self.raw_value!r}, children={len(self.children)})"


def _mark_dirty(node: Node) -> None:
    """A moved subtree must be re-rendered from its nodes, not from its old raw lines."""
    node.dirty = True
    node.line_no = None
    for c in node.children:
        _mark_dirty(c)


@dataclass(slots=True)
class Diagnostic:
    code: str
    message: str
    line_no: int | None = None   # 0-based raw line index
    severity: str = "info"       # info | warning | error

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message,
                "line": None if self.line_no is None else self.line_no + 1,
                "severity": self.severity}


@dataclass
class Document:
    header: Header
    root: Node
    raw_lines: list[str] = field(default_factory=list)
    blank_lines: set[int] = field(default_factory=set)
    diagnostics: list[Diagnostic] = field(default_factory=list)
    path: str | None = None

    @property
    def entity_type(self) -> str | None:
        node = self.root.get("entityType")
        return None if node is None else str(node.value)

    def get(self, key: str) -> Node | None:
        return self.root.get(key)

    def get_path(self, path: str) -> Node | None:
        return self.root.get_path(path)

    def scalar(self, path: str, default: Any = None) -> Any:
        return self.root.scalar(path, default)

    def is_dirty(self) -> bool:
        return any(n.dirty or n.deleted for _, n in self.root.walk())

    def to_json(self, include_raw: bool = False) -> dict[str, Any]:
        """
        Serialise for storage / the API.  ``include_raw`` adds the original
        lines and header details needed for byte-preserving writes later.
        """
        h = self.header
        out: dict[str, Any] = {
            "header": {"fmt": h.fmt, "archiveVersion": h.archive_version, "bom": h.bom, "newline": h.newline,
                       "trailingNewline": h.trailing_newline, "lineCount": h.line_count},
            "root": [c.to_json() for c in self.root.children if not c.deleted],
            "diagnostics": [d.to_dict() for d in self.diagnostics],
        }
        if include_raw:
            out["rawLines"] = self.raw_lines
            out["blankLines"] = sorted(self.blank_lines)
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> Document:
        hdr = data.get("header", {})
        header = Header(fmt=hdr.get("fmt"), archive_version=hdr.get("archiveVersion"), bom=hdr.get("bom", False),
                        newline=hdr.get("newline", "\n"), trailing_newline=hdr.get("trailingNewline", True),
                        line_count=hdr.get("lineCount", 0))
        root = Node("")
        root.children = [Node.from_json(c, root) for c in data.get("root", [])]
        diags = [Diagnostic(d["code"], d["message"], None if d.get("line") is None else d["line"] - 1, d.get("severity", "info"))
                 for d in data.get("diagnostics", [])]
        return cls(header=header, root=root, raw_lines=list(data.get("rawLines", [])),
                   blank_lines=set(data.get("blankLines", [])), diagnostics=diags)

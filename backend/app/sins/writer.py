"""
Serialises a ``Document`` back to Sins text.

``preserve`` mode re-emits the original bytes of every untouched line and only
regenerates lines whose value changed (plus new nodes), so a round-trip of an
unedited file is byte-identical.  ``pretty`` mode re-indents everything with
tabs.  Both keep document order, which is all the engine cares about.
"""
from __future__ import annotations

from .document import Document, Node
from .structure import COUNT_PAIRS

_BOM = "﻿"


def write(doc: Document, mode: str = "preserve") -> str:
    if mode not in ("preserve", "pretty"):
        raise ValueError("mode must be 'preserve' or 'pretty'")
    nl = doc.header.newline
    out: list[str] = []

    if doc.header.fmt:
        out.append(doc.header.fmt)
    if doc.header.archive_version is not None:
        out.append(f"SinsArchiveVersion {doc.header.archive_version}")

    blanks = sorted(doc.blank_lines) if mode == "preserve" else []
    blank_i = 0
    last_line = doc.header.line_count - 1

    for node in _iter_live(doc.root):
        if mode == "preserve" and node.line_no is not None:
            while blank_i < len(blanks) and blanks[blank_i] < node.line_no:
                if blanks[blank_i] > last_line:
                    out.append(doc.raw_lines[blanks[blank_i]])
                blank_i += 1
            last_line = node.line_no
        out.append(_render(node, doc, mode))

    if mode == "preserve":  # blank lines after the last node
        out.extend(doc.raw_lines[b] for b in blanks[blank_i:] if b > last_line)

    text = nl.join(out)
    if doc.header.trailing_newline or not out:
        text += nl
    return (_BOM if doc.header.bom else "") + text


def _iter_live(node: Node):
    for c in node.children:
        if c.deleted:
            continue
        yield c
        if c.children:
            yield from _iter_live(c)


def _render(node: Node, doc: Document, mode: str) -> str:
    original = doc.raw_lines[node.line_no] if node.line_no is not None and node.line_no < len(doc.raw_lines) else None
    if mode == "preserve" and original is not None and not node.dirty:
        return original
    if mode == "preserve" and original is not None:
        indent = original[: len(original) - len(original.lstrip(" \t"))]
    else:
        indent = "\t" * node.depth()
    if node.key == "":
        return f"{indent}{node.raw_value or ''}"
    return f"{indent}{node.key}" if node.raw_value is None else f"{indent}{node.key} {node.raw_value}"


def sync_counts(node: Node) -> int:
    """
    Recompute every ``numX`` / ``xCount`` value under ``node`` from the items
    that actually follow it.  Returns how many count values were corrected.
    """
    fixed = 0
    kids = node.live_children()
    for i, child in enumerate(kids):
        if child.children:
            fixed += sync_counts(child)
        item_key = COUNT_PAIRS.get(child.base_key)
        if item_key is None or child.is_block:
            continue
        n = 0
        for sib in kids[i + 1:]:
            if sib.base_key in COUNT_PAIRS and sib.base_key != item_key:
                break
            if sib.base_key == item_key:
                n += 1
        if child.value != n:
            child.set_value(n)
            fixed += 1
    return fixed


def count_mismatches(node: Node) -> list[tuple[Node, int, int]]:
    """Return (count_node, declared, actual) for every count that disagrees with its items."""
    out: list[tuple[Node, int, int]] = []
    kids = node.live_children()
    for i, child in enumerate(kids):
        if child.children:
            out.extend(count_mismatches(child))
        item_key = COUNT_PAIRS.get(child.base_key)
        if item_key is None or child.is_block or not isinstance(child.value, int):
            continue
        n = 0
        for sib in kids[i + 1:]:
            if sib.base_key in COUNT_PAIRS and sib.base_key != item_key:
                break
            if sib.base_key == item_key:
                n += 1
        if child.value != n:
            out.append((child, child.value, n))
    return out

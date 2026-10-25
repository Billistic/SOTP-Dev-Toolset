"""
Lossless editing of string tables (``String/*.str``).

A .str file is a flat list of ``StringInfo`` blocks (an ``ID`` and a
``Value`` line each) after a ``NumStrings`` count.  Rather than regenerating
the file, ``edit`` copies every line through byte for byte and only touches
what was asked: one ``Value`` line per edited ID, removed blocks, appended
blocks and the ``NumStrings`` count.  Newline style (per line), BOM,
indentation, ordering and duplicate IDs all survive.

Lines are split on ``\\n`` only (unlike ``str.splitlines``) so exotic Unicode
line separators inside a value can never be turned into line breaks.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

from . import values

_BOM = "﻿"
_LINE = re.compile(r"([ \t]*)(\S+)([ \t]*)(.*?)([ \t]*)$")   # indent, key, gap, value, trailing blanks


@dataclass(slots=True)
class Block:
    start: int                      # index of the StringInfo line
    end: int                        # index of the block's last ID / Value line (inclusive)
    string_id: str | None = None
    id_line: int | None = None
    value_line: int | None = None


@dataclass(slots=True)
class Scan:
    lines: list[str]                # each line WITH its own line ending
    blocks: list[Block] = field(default_factory=list)
    count_line: int | None = None   # the NumStrings line
    bom: bool = False
    newline: str = "\n"

    def first(self) -> dict[str, Block]:
        """ID -> first block defining it (the one the game keeps)."""
        out: dict[str, Block] = {}
        for b in self.blocks:
            if b.string_id is not None:
                out.setdefault(b.string_id, b)
        return out


def _split(line: str) -> tuple[str, str]:
    """(body, line ending)."""
    if line.endswith("\r\n"):
        return line[:-2], "\r\n"
    if line.endswith("\n"):
        return line[:-1], "\n"
    return line, ""


def _parts(line: str) -> tuple[str, str, str, str, str] | None:
    m = _LINE.match(_split(line)[0])
    return m.groups() if m else None   # type: ignore[return-value]


def scan(text: str) -> Scan:
    bom = text.startswith(_BOM)
    body = text[1:] if bom else text
    s = Scan(lines=re.findall(r"[^\n]*\n|[^\n]+$", body), bom=bom, newline="\r\n" if "\r\n" in body else "\n")
    current: Block | None = None
    for i, line in enumerate(s.lines):
        p = _parts(line)
        if p is None:                   # blank line: neither ends nor joins a block
            continue
        _, key, _, raw, _ = p
        if key == "StringInfo" and not raw:
            current = Block(start=i, end=i)
            s.blocks.append(current)
        elif current is not None and key in ("ID", "Value"):
            current.end = i
            if key == "ID" and current.id_line is None:
                current.id_line, current.string_id = i, str(values.to_python(raw)) if raw else ""
            elif key == "Value" and current.value_line is None:
                current.value_line = i
        else:
            current = None
            if key == "NumStrings" and s.count_line is None:
                s.count_line = i
    return s


def _token(value: str) -> str:
    return f'"{value}"'


def _with_value(line: str, token: str) -> str:
    """Replace the value of one ``key value`` line, keeping indent, gap, trailing blanks and line ending."""
    body, eol = _split(line)
    indent, key, gap, _, trail = _LINE.match(body).groups()   # type: ignore[union-attr]
    return f"{indent}{key}{gap or ' '}{token}{trail}{eol}"


def edit(text: str, set_values: Iterable[tuple[str, str]] = (), delete: Iterable[str] = ()) -> str:
    """
    Apply edits to .str text and return the new text.

    ``set_values``: (ID, value) pairs; an existing ID gets its first block's
    Value line replaced (later duplicates are left alone), an unknown ID is
    appended as a new block in the file's own style.  ``delete``: IDs whose
    blocks (every duplicate too) are removed.  When blocks were added or
    removed, ``NumStrings`` is set to the number of StringInfo blocks that
    remain; value-only edits leave it alone so they stay one-line changes.
    """
    s = scan(text)
    lines = list(s.lines)
    first = s.first()
    gone = set(delete)
    dropped: set[int] = set()
    for b in s.blocks:
        if b.string_id in gone:
            dropped.update(range(b.start, b.end + 1))

    added: list[tuple[str, str]] = []
    for sid, value in set_values:
        if sid in gone:
            continue
        b = first.get(sid)
        if b is None:
            added.append((sid, value))
        elif b.value_line is not None:
            if values.to_python(_parts(lines[b.value_line])[3] or '""') != value:
                lines[b.value_line] = _with_value(lines[b.value_line], _token(value))
        else:   # a block without a Value line: give it one right after its ID
            at = b.id_line if b.id_line is not None else b.start
            body, eol = _split(lines[at])
            lines[at] = f"{body}{eol or s.newline}{_parts(lines[at])[0]}Value {_token(value)}{eol}"

    survivors = [b for b in s.blocks if b.start not in dropped]
    total = len(survivors) + len(added)
    if (dropped or added) and s.count_line is not None and _parts(lines[s.count_line])[3] != str(total):
        lines[s.count_line] = _with_value(lines[s.count_line], str(total))

    out = [ln for i, ln in enumerate(lines) if i not in dropped]
    if added:
        out = _append(out, lines, s, survivors, dropped, added)
    return (_BOM if s.bom else "") + "".join(out)


def _append(out: list[str], lines: list[str], s: Scan, survivors: list[Block], dropped: set[int],
            added: list[tuple[str, str]]) -> list[str]:
    """Insert new blocks after the last surviving block (or after NumStrings), styled like the first block."""
    head, id_indent, val_indent, gap = "", "\t", "\t", " "
    if s.blocks:
        t = s.blocks[0]
        head = _parts(lines[t.start])[0]
        if t.id_line is not None:
            id_indent, _, g, _, _ = _parts(lines[t.id_line])
            gap = g or gap
        if t.value_line is not None:
            val_indent = _parts(lines[t.value_line])[0]
    nl = s.newline
    new: list[str] = []
    for sid, value in added:
        new += [f"{head}StringInfo{nl}", f"{id_indent}ID{gap}{_token(sid)}{nl}", f"{val_indent}Value{gap}{_token(value)}{nl}"]

    anchor = survivors[-1].end if survivors else s.count_line if s.count_line is not None else (0 if lines else -1)
    pos = sum(1 for i in range(anchor + 1) if i not in dropped)   # index in ``out`` just after the anchor line
    if pos > 0 and not out[pos - 1].endswith("\n"):       # the anchor was the file's unterminated last line
        out[pos - 1] += nl
        new[-1] = new[-1][: -len(nl)]
    return out[:pos] + new + out[pos:]


def generate(rows: Iterable[tuple[str, str]]) -> str:
    """A fresh .str file, for tables that do not exist on disk yet."""
    rows = list(rows)
    lines = ["TXT", f"NumStrings {len(rows)}"]
    for sid, value in rows:
        lines += ["StringInfo", f'\tID "{sid}"', f'\tValue "{value}"']
    return "\n".join(lines) + "\n"

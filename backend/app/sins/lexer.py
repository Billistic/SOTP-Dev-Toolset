"""
Line lexer for the Sins TXT/TXT2 format.

Turns file text into a flat, lossless list of ``Line`` records plus a
``Header``.  Structure (nesting) is decided later by the parser; the lexer only
normalises indentation into a depth hint and separates key from value.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

_LINE = re.compile(r"^([ \t]*)(\S+)(?:[ \t]+(.*?))?[ \t]*$")
_BOM = "\ufeff"


@dataclass(slots=True)
class Line:
    no: int                 # 0-based index into Document.raw_lines
    indent: str             # original leading whitespace
    key: str                # '' for key-less rows such as particle orientation vectors
    raw_value: str | None   # None → block header
    depth: int              # normalised indentation depth (tab = 1, 4 spaces = 1)


@dataclass(slots=True)
class Header:
    fmt: str | None = None            # 'TXT' | 'TXT2' | None when missing
    archive_version: int | None = None
    bom: bool = False
    newline: str = "\n"
    trailing_newline: bool = True
    line_count: int = 0               # number of raw lines consumed by the header


@dataclass(slots=True)
class LexResult:
    header: Header
    lines: list[Line]
    raw_lines: list[str]
    blank_lines: set[int] = field(default_factory=set)
    mixed_indent: bool = False


def depth_of(indent: str) -> int:
    """Tabs count as one level; runs of spaces count as ceil(n / 4) levels."""
    tabs = indent.count("\t")
    spaces = indent.count(" ")
    return tabs + math.ceil(spaces / 4)


def lex(text: str) -> LexResult:
    header = Header()
    if text.startswith(_BOM):
        header.bom = True
        text = text[1:]
    header.newline = "\r\n" if "\r\n" in text else "\n"
    header.trailing_newline = text.endswith(("\n", "\r"))

    raw_lines = text.splitlines()
    lines: list[Line] = []
    blanks: set[int] = set()
    saw_tab = saw_space = False

    start = 0
    if raw_lines and raw_lines[0].strip() in ("TXT", "TXT2"):
        header.fmt = raw_lines[0].strip()
        start = 1
    if start < len(raw_lines) and raw_lines[start].strip().startswith("SinsArchiveVersion"):
        parts = raw_lines[start].split()
        if len(parts) > 1 and parts[1].isdigit():
            header.archive_version = int(parts[1])
            start += 1
    header.line_count = start

    for no in range(start, len(raw_lines)):
        raw = raw_lines[no]
        if not raw.strip():
            blanks.add(no)
            continue
        m = _LINE.match(raw)
        if m is None:  # cannot happen for non-blank input, but stay defensive
            blanks.add(no)
            continue
        indent, key, value = m.group(1), m.group(2), m.group(3)
        if "\t" in indent:
            saw_tab = True
        if " " in indent:
            saw_space = True
        if key.startswith("["):
            # key-less vector row: the whole payload is the value
            value = raw.strip()
            key = ""
        elif value is not None and value == "":
            value = None
        lines.append(Line(no=no, indent=indent, key=key, raw_value=value, depth=depth_of(indent)))

    return LexResult(header=header, lines=lines, raw_lines=raw_lines,
                     blank_lines=blanks, mixed_indent=saw_tab and saw_space)

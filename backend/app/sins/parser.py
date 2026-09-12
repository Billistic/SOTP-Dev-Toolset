"""
Builds a ``Document`` tree from lexed lines.

Indentation is the primary nesting signal, but a block header also adopts a
following line at the same (or shallower) indentation when ``structure``
says the key belongs to it — this mirrors what the engine does and repairs
the corpus's generator artefacts without reordering anything.  Every such
repair is recorded as a diagnostic so the mod team can see it.
"""
from __future__ import annotations

from pathlib import Path

from .document import Diagnostic, Document, Node
from .lexer import Line, lex
from .structure import CHILDREN_OF


def parse(text: str, path: str | None = None) -> Document:
    lexed = lex(text)
    root = Node("")
    doc = Document(header=lexed.header, root=root, raw_lines=lexed.raw_lines,
                   blank_lines=lexed.blank_lines, path=path)

    if lexed.header.bom:
        doc.diagnostics.append(Diagnostic("BOM", "File starts with a UTF-8 byte-order mark.", 0, "info"))
    if lexed.header.fmt is None:
        doc.diagnostics.append(Diagnostic("NO_FORMAT_HEADER", "Missing TXT/TXT2 header line.", 0, "error"))
    if lexed.mixed_indent:
        doc.diagnostics.append(Diagnostic("MIXED_INDENT", "File mixes tabs and spaces for indentation.", None, "info"))

    # stack of (node, depth); root sits at depth -1 so it accepts everything
    stack: list[tuple[Node, int]] = [(root, -1)]

    for line in lexed.lines:
        adopted = False
        while len(stack) > 1:
            top, top_depth = stack[-1]
            if line.depth > top_depth:
                break
            if _belongs_by_schema(line, top):
                adopted = True
                break
            stack.pop()

        parent, _ = stack[-1]
        node = Node(line.key, line.raw_value, line.no)
        node.parent = parent
        parent.children.append(node)

        if adopted:
            doc.diagnostics.append(Diagnostic(
                "INDENT_ADOPTED",
                f"'{line.key}' is indented as a sibling of '{parent.key}' but the engine reads it as a child.",
                line.no, "info"))
        if line.key == "" and parent.key != "Orientation":
            doc.diagnostics.append(Diagnostic("KEYLESS_ROW", "Key-less value row.", line.no, "warning"))

        if node.is_block:
            stack.append((node, line.depth))

    return doc


def _belongs_by_schema(line: Line, header: Node) -> bool:
    if not header.is_block:
        return False
    allowed = CHILDREN_OF.get(header.base_key)
    if not allowed:
        return False
    base = line.key.split(":", 1)[0]
    return base in allowed


def parse_file(path: str | Path, *, max_bytes: int | None = None) -> Document:
    """
    Parse a file from disk.  ``max_bytes`` lets callers read only the head of
    very large files (text meshes carry megabytes of vertex data after the
    header block we care about).
    """
    p = Path(path)
    raw = p.read_bytes() if max_bytes is None else p.open("rb").read(max_bytes)
    text = raw.decode("utf-8", errors="replace")
    if max_bytes is not None:
        text = text.rsplit("\n", 1)[0]  # drop a possibly truncated last line
    doc = parse(text, str(p))
    return doc

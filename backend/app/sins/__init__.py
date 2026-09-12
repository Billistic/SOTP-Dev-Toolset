"""
Pure-Python library for the Sins of a Solar Empire: Rebellion text format.

No database or web-framework imports live here; everything in this package
works on strings, files and the in-memory ``Document`` tree so it can be unit
tested against the real mod corpus and reused from scripts.
"""
from .document import Document, Node
from .parser import parse, parse_file
from .writer import write

__all__ = ["Document", "Node", "parse", "parse_file", "write"]

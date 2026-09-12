"""
Typed view over raw Sins value tokens.

The raw token text is always retained by the tree so an unchanged value
round-trips byte-for-byte; these helpers only classify and convert.
"""
from __future__ import annotations

import re
from typing import Any

_INT = re.compile(r"-?\d+$")
_FLOAT = re.compile(r"-?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$")
_HEX = re.compile(r"[0-9a-fA-F]{8}$")


class Kind:
    STRING = "string"
    INT = "int"
    FLOAT = "float"
    BOOL = "bool"
    HEX = "hex"
    ARRAY = "array"
    BARE = "bare"  # unquoted identifier — not seen in the corpus, kept for safety


def classify(raw: str) -> str:
    """Return the ``Kind`` of a raw value token."""
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        return Kind.STRING
    if raw in ("TRUE", "FALSE"):
        return Kind.BOOL
    if _INT.match(raw):
        return Kind.INT
    if _FLOAT.match(raw):
        return Kind.FLOAT
    if _HEX.match(raw):
        return Kind.HEX
    if raw.startswith("["):
        return Kind.ARRAY
    return Kind.BARE


def to_python(raw: str) -> Any:
    """Convert a raw token to the closest Python value."""
    kind = classify(raw)
    if kind == Kind.STRING:
        return raw[1:-1]
    if kind == Kind.BOOL:
        return raw == "TRUE"
    if kind == Kind.INT:
        return int(raw)
    if kind == Kind.FLOAT:
        return float(raw)
    if kind == Kind.ARRAY:
        return [to_python(tok) for tok in _split_array(raw)]
    return raw  # hex colours and bare identifiers stay as text


def _split_array(raw: str) -> list[str]:
    inner = raw.strip()[1:-1]
    return [tok for tok in re.split(r"[,\s]+", inner.strip()) if tok]


def _decimals(like: str | None) -> int | None:
    """Number of decimal places used by the previous raw token, if it was a float."""
    if like and classify(like) == Kind.FLOAT and "." in like:
        return len(re.split(r"[eE]", like.split(".", 1)[1])[0])
    return None


def from_python(value: Any, like: str | None = None) -> str:
    """
    Format a Python value as a Sins token, mimicking the style of ``like``
    (the previous raw token) so edits do not churn number formatting.
    """
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (list, tuple)):
        sep = " , " if (like and " , " in like) else ", " if (like and "," in like) else " "   # keep the file's own spacing
        items = [from_python(v, None) for v in value]
        return "[ " + sep.join(items) + " ]"
    if isinstance(value, int):
        if like is not None and classify(like) == Kind.FLOAT:
            return from_python(float(value), like)
        return str(value)
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("non-finite float cannot be written to a Sins file")
        places = _decimals(like)
        if places is None:
            text = repr(value)
            return text if "." in text or "e" in text else text + ".0"
        return f"{value:.{max(places, 1)}f}"
    if isinstance(value, str):
        if like is not None and classify(like) in (Kind.HEX, Kind.BARE) and _HEX.match(value):
            return value
        if '"' in value:
            raise ValueError("Sins strings cannot contain double quotes")
        return f'"{value}"'
    if value is None:
        return '""'
    raise TypeError(f"unsupported value type: {type(value).__name__}")

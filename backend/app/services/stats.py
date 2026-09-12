"""Small dependency-free descriptive statistics used by analytics and balance."""
from __future__ import annotations

import math
from typing import Any, Sequence


def describe(values: Sequence[float]) -> dict[str, Any]:
    xs = sorted(v for v in values if v is not None and not math.isnan(v))
    n = len(xs)
    if n == 0:
        return {"count": 0}
    mean = sum(xs) / n
    var = sum((x - mean) ** 2 for x in xs) / (n - 1) if n > 1 else 0.0
    med = quantile(xs, 0.5)
    mad = quantile(sorted(abs(x - med) for x in xs), 0.5)
    return {"count": n, "mean": mean, "std": math.sqrt(var), "min": xs[0], "q1": quantile(xs, 0.25),
            "median": med, "q3": quantile(xs, 0.75), "max": xs[-1], "mad": mad}


def quantile(sorted_xs: Sequence[float], q: float) -> float:
    if not sorted_xs:
        return float("nan")
    pos = (len(sorted_xs) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    if lo == hi:
        return float(sorted_xs[lo])
    return float(sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (pos - lo))


def robust_z(value: float, stats: dict[str, Any]) -> float | None:
    """Median/MAD based z-score; falls back to mean/std when MAD is zero."""
    if stats.get("count", 0) < 2:
        return None
    mad = stats.get("mad") or 0.0
    if mad > 0:
        return 0.6745 * (value - stats["median"]) / mad
    std = stats.get("std") or 0.0
    return (value - stats["mean"]) / std if std > 0 else 0.0


def percentile_rank(value: float, values: Sequence[float]) -> float | None:
    xs = [v for v in values if v is not None]
    if not xs:
        return None
    below = sum(1 for v in xs if v < value)
    equal = sum(1 for v in xs if v == value)
    return round(100.0 * (below + 0.5 * equal) / len(xs), 1)

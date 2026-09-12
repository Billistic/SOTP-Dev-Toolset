"""
Rule-based balance recommendations (v0).

For every peer group (e.g. Frigate / Heavy across all factions) each entity's
efficiency metrics are compared with the group's robust centre.  Outliers
beyond ``z_threshold`` become recommendations with concrete levers
("raise cost to X" / "scale weapon damage by Y").  Everything is explainable
and data-driven so a fitted model can replace the heuristics later.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from ..dao import EntityDAO
from ..models import Entity, Project
from .analytics_service import peer_key
from .stats import describe, robust_z

# metric -> (label, "high is strong"?, levers that move it)
_SHIP_METRICS: dict[str, tuple[str, bool, tuple[str, ...]]] = {
    "dps_per_cost": ("damage per resource", True, ("cost_total", "dps_total")),
    "ehp_per_cost": ("durability per resource", True, ("cost_total", "ehp")),
    "dps_per_supply": ("damage per fleet supply", True, ("slot_count", "dps_total")),
    "speed": ("speed", True, ("speed",)),
    "max_range": ("weapon range", True, ("max_range",)),
}
_MODULE_METRICS = {
    "hull": ("hull", True, ("hull", "cost_total")),
    "cost_total": ("cost", False, ("cost_total",)),
}
_RESEARCH_METRICS = {
    "cost_total": ("cost", False, ("cost_total",)),
    "base_time": ("research time", False, ("base_time",)),
}
METRICS_BY_CATEGORY = {"ship": _SHIP_METRICS, "module": _MODULE_METRICS, "research": _RESEARCH_METRICS}

_LEVER_HINTS = {
    "cost_total": "adjust basePrice (credits/metal/crystal)",
    "dps_total": "scale weapon DamagePerBank or PreBuffCooldownTime",
    "ehp": "adjust MaxHullPoints / MaxShieldPoints / armor",
    "slot_count": "adjust slotCount",
    "speed": "adjust maxSpeedLinear",
    "max_range": "adjust weapon Range",
    "hull": "adjust MaxHullPoints",
    "base_time": "adjust BaseUpgradeTime",
}


class BalanceService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)

    def _candidates(self, project: Project, category: str, entity_type: str | None, reachable_only: bool) -> list[Entity]:
        ents = self.entities.list(project.id, category=category, entity_type=entity_type, limit=100000)
        ents = [e for e in ents if "placeholder" not in e.name.lower()]
        if reachable_only:  # only units some Player can actually build / research (flagship slot excluded)
            listed = {m.member_name.lower() for m in self.entities.all_members(project.id) if m.slot != "flagship"}
            ents = [e for e in ents if e.name.lower() in listed]
        if category == "ship":  # placeholder-priced units would poison every ratio
            ents = [e for e in ents if (e.typed_json or {}).get("cost_total", 1) != 0]
        return ents

    def recommendations(self, project: Project, *, category: str = "ship", z_threshold: float = 1.5,
                        min_group: int = 3, entity_type: str | None = None, reachable_only: bool = True) -> dict[str, Any]:
        metrics = METRICS_BY_CATEGORY.get(category, {})
        groups: dict[tuple, list[Entity]] = defaultdict(list)
        for e in self._candidates(project, category, entity_type, reachable_only):
            groups[peer_key(e)].append(e)

        recs: list[dict[str, Any]] = []
        group_summaries = []
        for key, members in groups.items():
            if len(members) < min_group:
                continue
            stats = {m: describe([float((e.typed_json or {}).get(m)) for e in members
                                  if isinstance((e.typed_json or {}).get(m), (int, float))]) for m in metrics}
            group_summaries.append({"group": " / ".join(str(k) for k in key), "size": len(members),
                                    "factions": sorted({e.faction or "?" for e in members}),
                                    "stats": {m: {k: v for k, v in s.items() if k in ("count", "median", "mean", "min", "max")} for m, s in stats.items()}})
            for e in members:
                t = e.typed_json or {}
                for m, (label, high_is_strong, levers) in metrics.items():
                    value = t.get(m)
                    st = stats[m]
                    if not isinstance(value, (int, float)) or st.get("count", 0) < min_group:
                        continue
                    z = robust_z(float(value), st)
                    if z is None or abs(z) < z_threshold:
                        continue
                    recs.append(self._recommendation(e, key, m, label, float(value), st, z, high_is_strong, levers))

        recs.sort(key=lambda r: -abs(r["z"]))
        return {"category": category, "zThreshold": z_threshold, "groups": group_summaries, "recommendations": recs}

    def _recommendation(self, e: Entity, key: tuple, metric: str, label: str, value: float, st: dict,
                        z: float, high_is_strong: bool, levers: tuple[str, ...]) -> dict[str, Any]:
        median = st["median"]
        strong = (z > 0) == high_is_strong
        ratio = (median / value) if value else None
        lever_plans = []
        t = e.typed_json or {}
        for lever in levers:
            current = t.get(lever)
            if not isinstance(current, (int, float)) or ratio is None:
                continue
            # ratios: cost-type levers move opposite to efficiency metrics
            inverse = lever in ("cost_total", "slot_count") and metric != lever
            target = current / ratio if inverse else current * ratio
            lever_plans.append({"lever": lever, "current": round(current, 3), "target": round(target, 3),
                                "changePct": round((target / current - 1) * 100, 1) if current else None,
                                "hint": _LEVER_HINTS.get(lever, "")})
        direction = "over-tuned" if strong else "under-tuned"
        return {
            "entity": e.name, "displayName": e.display_name, "entityType": e.entity_type, "faction": e.faction,
            "group": " / ".join(str(k) for k in key), "metric": metric, "label": label,
            "value": round(value, 4), "median": round(median, 4), "z": round(z, 2), "direction": direction,
            "severity": "high" if abs(z) >= 3 else "medium" if abs(z) >= 2 else "low",
            "summary": f"{e.name} has {label} {round(value, 3)} vs peer median {round(median, 3)} ({direction}, z={round(z, 1)}).",
            "levers": lever_plans,
        }

    def faction_symmetry(self, project: Project, category: str = "ship", reachable_only: bool = True) -> list[dict[str, Any]]:
        """Per peer group, how each faction's median compares on the key metrics."""
        metrics = METRICS_BY_CATEGORY.get(category, {})
        buckets: dict[tuple, dict[str, list[Entity]]] = defaultdict(lambda: defaultdict(list))
        for e in self._candidates(project, category, None, reachable_only):
            buckets[peer_key(e)][e.faction or "?"].append(e)
        out = []
        for key, by_faction in buckets.items():
            if len(by_faction) < 2:
                continue
            row: dict[str, Any] = {"group": " / ".join(str(k) for k in key), "factions": {}}
            for faction, members in by_faction.items():
                row["factions"][faction] = {"count": len(members), **{
                    m: describe([float((x.typed_json or {}).get(m)) for x in members
                                 if isinstance((x.typed_json or {}).get(m), (int, float))]).get("median") for m in metrics}}
            out.append(row)
        return out

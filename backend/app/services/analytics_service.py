"""
Descriptive analytics over the ingested mod: distributions of any numeric
field, typed-metric comparisons across factions/roles, and per-entity peer
profiles.  Pure reads; nothing here mutates state.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..dao import DiagnosticDAO, EntityDAO, FieldDAO, StringDAO
from ..models import Entity, Prerequisite, Project, ResearchModifier, Weapon
from .stats import describe, percentile_rank, robust_z

# typed_json metrics that make sense to compare, per category
METRICS: dict[str, list[str]] = {
    "ship": ["cost_total", "credits", "metal", "crystal", "slot_count", "build_time", "hull", "shield", "armor",
             "ehp", "hull_regen", "shield_regen", "antimatter", "speed", "acceleration", "turn_rate", "mass",
             "dps_total", "dps_all_banks", "dps_anti_fighter", "max_range", "weapon_count",
             "dps_per_cost", "ehp_per_cost", "dps_per_supply", "xp_for_destroying"],
    "module": ["cost_total", "credits", "metal", "crystal", "build_time", "hull", "shield", "armor", "hull_regen",
               "shield_regen", "slot_count", "culture_spread", "trade_income", "weapon_count"],
    "research": ["cost_total", "credits", "metal", "crystal", "base_time", "per_level_time", "tier", "max_levels",
                 "float_modifier_count", "bool_modifier_count", "priority"],
    "squad": ["fighters_per_squad", "fighter_build_time"],
}

# how peers are grouped for comparison, per category
PEER_KEYS: dict[str, tuple[str, ...]] = {
    "ship": ("entity_type", "role"),
    "module": ("entity_type", "role"),
    "research": ("field", "tier"),
    "squad": ("role",),
}


def peer_key(entity: Entity) -> tuple:
    """Grouping key used to pick comparable peers for an entity."""
    t = entity.typed_json or {}
    values = []
    for k in PEER_KEYS.get(entity.category, ()):
        if k == "entity_type":
            values.append(entity.entity_type)
        elif k == "role":
            values.append(entity.role)
        else:
            values.append(t.get(k))
    return tuple(values)


class AnalyticsService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)
        self.fields = FieldDAO(db)

    # ── overview ────────────────────────────────────────────────────────
    def overview(self, project: Project) -> dict[str, Any]:
        return {
            "types": self.entities.type_counts(project.id),
            "factions": self.entities.faction_counts(project.id),
            "strings": StringDAO(self.db).count(project.id),
            "diagnostics": DiagnosticDAO(self.db).summary(project.id)["bySeverity"],
        }

    # ── any numeric field ───────────────────────────────────────────────
    def field_catalog(self, project: Project, entity_type: str) -> list[dict[str, Any]]:
        return [c for c in self.fields.field_catalog(project.id, entity_type) if c["numericCount"] > 0]

    def distribution(self, project: Project, entity_type: str, path: str, group_by: str = "faction") -> dict[str, Any]:
        rows = self.fields.numeric_values(project.id, entity_type, path)
        groups: dict[str, list[float]] = defaultdict(list)
        points = []
        for name, faction, role, value in rows:
            key = {"faction": faction, "role": role}.get(group_by) or "(none)"
            groups[key].append(value)
            points.append({"name": name, "faction": faction, "role": role, "value": value})
        return {"path": path, "entityType": entity_type, "overall": describe([p["value"] for p in points]),
                "groups": {k: describe(v) for k, v in sorted(groups.items())}, "points": points}

    # ── typed metrics ───────────────────────────────────────────────────
    def metric_table(self, project: Project, category: str, entity_type: str | None = None) -> dict[str, Any]:
        metrics = METRICS.get(category, [])
        ents = self.entities.list(project.id, category=category, entity_type=entity_type, limit=100000)
        rows = [{"name": e.name, "displayName": e.display_name, "entityType": e.entity_type, "race": e.race,
                 "faction": e.faction, "role": e.role, **{m: (e.typed_json or {}).get(m) for m in metrics}} for e in ents]
        by_group: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for r in rows:
            for m in metrics:
                if isinstance(r.get(m), (int, float)):
                    by_group[r["faction"] or "(none)"][m].append(float(r[m]))
        summary = {g: {m: describe(v) for m, v in ms.items()} for g, ms in by_group.items()}
        return {"metrics": metrics, "rows": rows, "byFaction": summary}

    def peer_profile(self, project: Project, entity: Entity) -> dict[str, Any]:
        """Where this entity sits among its peers on every comparable metric."""
        metrics = METRICS.get(entity.category, [])
        if not metrics:
            return {"metrics": [], "peers": 0}
        peers = self._peers(project, entity)
        out = []
        t = entity.typed_json or {}
        for m in metrics:
            value = t.get(m)
            vals = [float((p.typed_json or {}).get(m)) for p in peers if isinstance((p.typed_json or {}).get(m), (int, float))]
            st = describe(vals)
            z = robust_z(float(value), st) if isinstance(value, (int, float)) and st.get("count") else None
            out.append({"metric": m, "value": value, "stats": st, "z": None if z is None else round(z, 2),
                        "percentile": percentile_rank(float(value), vals) if isinstance(value, (int, float)) else None})
        return {"peerGroup": self._peer_label(entity), "peers": len(peers),
                "peerNames": [p.name for p in peers], "metrics": out}

    def _peers(self, project: Project, entity: Entity) -> list[Entity]:
        key = peer_key(entity)
        return [p for p in self.entities.list(project.id, category=entity.category, limit=100000)
                if p.id != entity.id and peer_key(p) == key]

    def _peer_label(self, entity: Entity) -> str:
        return " / ".join(str(k) for k in peer_key(entity))

    # ── domain summaries ────────────────────────────────────────────────
    def weapon_summary(self, project: Project) -> dict[str, Any]:
        stmt = (select(Entity.faction, Weapon.attack_type, Weapon.damage_type, Weapon.weapon_class,
                       func.count(), func.sum(Weapon.dps_best_bank), func.avg(Weapon.range))
                .join(Entity, Entity.id == Weapon.entity_id).where(Entity.project_id == project.id)
                .group_by(Entity.faction, Weapon.attack_type, Weapon.damage_type, Weapon.weapon_class))
        rows = [{"faction": f, "attackType": a, "damageType": d, "weaponClass": c, "count": n,
                 "dps": round(s or 0, 2), "avgRange": round(r or 0, 1)} for f, a, d, c, n, s, r in self.db.execute(stmt)]
        return {"rows": rows}

    def research_summary(self, project: Project) -> dict[str, Any]:
        ents = self.entities.list(project.id, entity_type="ResearchSubject", limit=100000)
        by_ft: dict[tuple, dict[str, float]] = defaultdict(lambda: {"count": 0, "cost": 0.0, "time": 0.0})
        for e in ents:
            t = e.typed_json or {}
            k = by_ft[(e.faction, t.get("field"), t.get("tier"))]
            k["count"] += 1
            k["cost"] += float(t.get("cost_total") or 0)
            k["time"] += float(t.get("base_time") or 0)
        tiers = [{"faction": f, "field": fld, "tier": tier, **v} for (f, fld, tier), v in sorted(by_ft.items(), key=lambda x: (str(x[0][0]), str(x[0][1]), str(x[0][2])))]
        mods = self.db.execute(select(Entity.faction, ResearchModifier.modifier_type, func.count(),
                                      func.sum(ResearchModifier.base_value + ResearchModifier.per_level_value))
                               .join(Entity, Entity.id == ResearchModifier.entity_id).where(Entity.project_id == project.id)
                               .group_by(Entity.faction, ResearchModifier.modifier_type)).all()
        return {"tiers": tiers, "modifiers": [{"faction": f, "modifierType": m, "count": n, "totalPerLevel1": round(s or 0, 3)} for f, m, n, s in mods]}

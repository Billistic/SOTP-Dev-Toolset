"""
What a unit's own abilities do to its numbers.  The Analytics tables always show the
file values; this follows ship -> ability -> buff -> nested buffs, reads the entity
modifiers per level, and re-derives the typed metrics with a chosen set of buffs
applied so "ability on" can be set beside "ability off" without touching the tables.

Modifier values are the engine's fractions (``WeaponCooldown 0.25`` = +25 % cooldown);
same-type modifiers from several buffs are summed before being applied, which is how
the engine stacks percentage modifiers.  Types the model does not understand are still
reported (``modelled: false``) so nothing is silently dropped.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from ..dao import EntityDAO
from ..models import Entity, Project
from ..sins import Document, Node
from ..sins.schemas.units import ARMOR_WEIGHT

# buffEntityModifierType -> (metric it scales, how): "pct" multiplies by (1 + v), "add" adds v
MODIFIERS: dict[str, tuple[str, str, str]] = {
    "WeaponDamage": ("dps", "pct", "all weapon damage"),
    "WeaponCooldown": ("cooldown", "pct", "time between shots (negative = faster)"),
    "WeaponRange": ("max_range", "pct", "weapon range"),
    "MaxHullPoints": ("hull", "pct", "hull points"),
    "MaxShieldPoints": ("shield", "pct", "shield points"),
    "MaxAntiMatter": ("antimatter", "pct", "antimatter pool"),
    "HullPointRestoreRate": ("hull_regen", "pct", "hull regeneration"),
    "ShieldPointRestoreRate": ("shield_regen", "pct", "shield regeneration"),
    "AntiMatterRestoreRate": ("antimatter_regen", "pct", "antimatter regeneration"),
    "ArmorPointsAdjustment": ("armor", "add", "armour points (flat)"),
    "ShieldMitigation": ("mitigation", "add", "shield mitigation (flat)"),
    "MaxLinearSpeed": ("speed", "pct", "top speed"),
    "LinearThrust": ("acceleration", "pct", "linear thrust"),
    "AngularThrust": ("turn_rate", "pct", "turning thrust"),
    "Mass": ("mass", "pct", "mass"),
    "DamageAsDamageTargetFromForward": ("damage_taken_front", "pct", "damage taken from the forward arc"),
}
# metrics the compare table lists, in order; only those that exist on the unit are returned
METRICS = ["hull", "shield", "armor", "ehp", "ehp_frontal", "hull_regen", "shield_regen", "mitigation", "antimatter",
           "antimatter_regen", "speed", "acceleration", "turn_rate", "mass", "dps_total", "dps_all_banks",
           "dps_anti_fighter", "max_range", "dps_per_cost", "ehp_per_cost", "dps_per_supply"]
MAX_DEPTH = 6


@dataclass
class ChainBuff:
    """One buff reached from an ability, with how and under what condition it is applied."""
    id: str
    name: str
    exists: bool
    ability: str
    parent: str | None
    depth: int
    via: str                       # the action type that applies it (ApplyBuffToSelf, ...)
    applies_to: str                # self | spawner | target
    trigger: str | None = None     # instantActionTriggerType
    condition: dict[str, Any] | None = None   # {"type": "IfOwnerHasHullLessThanPerc", "value": 0.75}
    finish: list[dict[str, Any]] = field(default_factory=list)
    levels: int = 1
    modifiers: list[dict[str, Any]] = field(default_factory=list)
    bool_modifiers: list[str] = field(default_factory=list)
    other_actions: list[str] = field(default_factory=list)   # damage / drains etc. that do not change own stats

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "exists": self.exists, "ability": self.ability, "parent": self.parent,
                "depth": self.depth, "via": self.via, "appliesTo": self.applies_to, "trigger": self.trigger,
                "condition": self.condition, "finish": self.finish, "levels": self.levels, "modifiers": self.modifiers,
                "boolModifiers": self.bool_modifiers, "otherActions": self.other_actions}


class BuffService:
    def __init__(self, db: Session):
        self.db = db
        self.entities = EntityDAO(db)
        self._docs: dict[str, Document | None] = {}

    # ── one unit ────────────────────────────────────────────────────────
    def impact(self, project: Project, entity: Entity, *, level: int = 0, hull: float = 1.0,
               active: set[str] | None = None, peers: bool = False) -> dict[str, Any]:
        """
        Ability chain plus base / buffed metrics.  ``active`` names chain ids to apply; when omitted the
        set is derived: self-applied buffs whose condition holds at ``hull`` (fraction of max hull).
        With ``peers`` every metric also carries robust z-scores against the unit's peer group (same
        entity type and role): base against the peers' file values, buffed against the peers put
        through the same hull / level scenario with their own buffs.
        """
        abilities, chain = self._chain(project, entity)
        levels = max([b.levels for b in chain] + [1])
        level = max(0, min(level, levels - 1))
        auto = active is None
        on: set[str] = set()
        for b in chain:   # parents first (chain is in discovery order, parents before children)
            if b.applies_to == "target" or not b.exists:
                continue
            if auto:
                if b.parent and b.parent not in on:
                    continue
                if not _condition_holds(b.condition, hull, level):
                    continue
                on.add(b.id)
            elif b.id in active:
                on.add(b.id)
        totals: dict[str, float] = {}
        unmodelled: list[dict[str, Any]] = []
        for b in chain:
            for m in b.modifiers:
                m["value"] = _at_level(m["values"], level)
                m["active"] = b.id in on
                if not m["modelled"]:
                    if b.id in on:
                        unmodelled.append({"buff": b.name, "type": m["type"], "value": m["value"]})
                    continue
                if b.id in on and m["value"] is not None:
                    totals[m["type"]] = totals.get(m["type"], 0.0) + m["value"]
        base = self._base(entity)
        buffed = apply_modifiers(base, totals)
        metrics = [{"metric": k, "base": base.get(k), "buffed": buffed.get(k), "delta": _delta(base.get(k), buffed.get(k))}
                   for k in METRICS if k in base]
        out = {
            "entity": entity.name, "level": level, "levels": levels, "hull": hull,
            "abilities": abilities, "chain": [b.to_dict() for b in chain], "active": sorted(on), "auto": auto,
            "totals": totals, "unmodelled": unmodelled, "metrics": metrics,
        }
        if peers:
            out["peers"] = self._peer_context(project, entity, metrics, level=level, hull=hull)
        return out

    def _peer_context(self, project: Project, entity: Entity, metrics: list[dict[str, Any]], *, level: int, hull: float) -> dict[str, Any]:
        """Robust z of this unit's base and buffed values among its peers (peers buffed under the same scenario)."""
        from .analytics_service import AnalyticsService   # local: analytics imports nothing from here, but keep the graph one-way
        from .stats import describe, percentile_rank, robust_z
        svc = AnalyticsService(self.db)
        group = svc._peers(project, entity)
        peer_base = [self._base(p) for p in group]
        peer_buffed = []
        for p in group:   # each peer with its own abilities under the same hull / level assumptions
            r = self.impact(project, p, level=level, hull=hull)
            peer_buffed.append({m["metric"]: m["buffed"] for m in r["metrics"]})
        for m in metrics:
            k = m["metric"]
            bases = [pb[k] for pb in peer_base if isinstance(pb.get(k), (int, float))]
            buffs = [pb[k] for pb in peer_buffed if isinstance(pb.get(k), (int, float))]
            sb, sf = describe(bases), describe(buffs)
            zb = robust_z(float(m["base"]), sb) if m["base"] is not None and sb.get("count") else None
            zf = robust_z(float(m["buffed"]), sf) if m["buffed"] is not None and sf.get("count") else None
            m["peer"] = {"zBase": None if zb is None else round(zb, 2), "zBuffed": None if zf is None else round(zf, 2),
                         "medianBase": sb.get("median"), "medianBuffed": sf.get("median"),
                         "percentileBuffed": percentile_rank(float(m["buffed"]), buffs) if m["buffed"] is not None and buffs else None}
        return {"group": svc._peer_label(entity), "count": len(group), "names": [p.name for p in group]}

    # ── every unit of a category ────────────────────────────────────────
    def summary(self, project: Project, category: str = "ship", *, level: int = 0, hull: float = 1.0) -> dict[str, Any]:
        """Base vs buffed headline metrics for every unit that carries at least one modelled self-buff."""
        rows = []
        for e in self.entities.list(project.id, category=category, limit=100000):
            if not (e.typed_json or {}).get("abilities"):
                continue
            r = self.impact(project, e, level=level, hull=hull)
            if not r["totals"] and not r["unmodelled"] and not any(not a["exists"] for a in r["abilities"]):
                continue
            metrics = {m["metric"]: m for m in r["metrics"]}
            rows.append({
                "name": e.name, "displayName": e.display_name, "entityType": e.entity_type, "race": e.race,
                "faction": e.faction, "role": e.role,
                "abilities": [a["name"] for a in r["abilities"]], "missingAbilities": [a["name"] for a in r["abilities"] if not a["exists"]],
                "activeBuffs": r["active"], "unmodelled": len(r["unmodelled"]),
                **{f"{k}_base": metrics[k]["base"] for k in HEADLINE if k in metrics},
                **{f"{k}_buffed": metrics[k]["buffed"] for k in HEADLINE if k in metrics},
                **{f"{k}_pct": (metrics[k]["delta"] or {}).get("pct") for k in HEADLINE if k in metrics},
            })
        return {"category": category, "level": level, "hull": hull, "headline": HEADLINE, "rows": rows}

    # ── chain discovery ─────────────────────────────────────────────────
    def _chain(self, project: Project, entity: Entity) -> tuple[list[dict[str, Any]], list[ChainBuff]]:
        abilities: list[dict[str, Any]] = []
        chain: list[ChainBuff] = []
        doc = Document.from_json(entity.tree_json)
        for slot in doc.root.all("ability"):
            name = slot.value
            if not name:
                continue
            adoc = self._doc(project, str(name))
            info = {"slot": slot.key, "name": str(name), "exists": adoc is not None}
            if adoc is not None:
                info.update({
                    "useCost": adoc.scalar("useCostType"), "trigger": adoc.scalar("instantActionTriggerType"),
                    "autoCast": bool(adoc.scalar("isAutoCastAvailable")), "levelSource": adoc.scalar("levelSourceType"),
                    "maxLevels": adoc.scalar("maxNumLevels"), "action": adoc.scalar("buffInstantActionType"),
                })
                for act in _actions(adoc.root, top_level=True):
                    self._follow(project, act, str(name), None, 0, chain, [])
            abilities.append(info)
        return abilities, chain

    def _follow(self, project: Project, act: dict[str, Any], ability: str, parent: str | None, depth: int,
                chain: list[ChainBuff], seen: list[str]) -> None:
        name = act["buff"]
        if depth > MAX_DEPTH or name in seen:   # cycles (buff A re-applies A) end here
            return
        bdoc = self._doc(project, name)
        cid = f"{ability}/{'/'.join(seen + [name])}"
        b = ChainBuff(id=cid, name=name, exists=bdoc is not None, ability=ability, parent=parent, depth=depth,
                      via=act["type"], applies_to=_applies_to(act["type"]), trigger=act.get("trigger"), condition=act.get("condition"))
        chain.append(b)
        if bdoc is None:
            return
        root = bdoc.root
        for m in root.all("entityModifier"):
            mtype = str(m.scalar("buffEntityModifierType") or "")
            values = _levels(m.get("value"))
            spec = MODIFIERS.get(mtype)
            b.modifiers.append({"type": mtype, "values": values, "modelled": spec is not None,
                                "metric": spec[0] if spec else None, "mode": spec[1] if spec else None, "label": spec[2] if spec else mtype})
            b.levels = max(b.levels, len(values))
        b.bool_modifiers = [str(m.scalar("buffEntityBoolModifierType") or "") for m in root.all("entityBoolModifier")]
        for f in root.all("finishCondition"):
            ftype = str(f.scalar("finishConditionType") or "")
            vals = _levels(_value_after(f, "finishConditionType"))
            b.finish.append({"type": ftype, "values": vals})
            b.levels = max(b.levels, len(vals))
        for act2 in _actions(root):
            if act2.get("buff"):
                self._follow(project, act2, ability, cid, depth + 1, chain, seen + [name])
            else:
                b.other_actions.append(act2["type"])

    # ── helpers ─────────────────────────────────────────────────────────
    def _doc(self, project: Project, name: str) -> Document | None:
        if name not in self._docs:
            e = self.entities.by_name(project.id, name)
            self._docs[name] = Document.from_json(e.tree_json) if e is not None else None
        return self._docs[name]

    @staticmethod
    def _base(entity: Entity) -> dict[str, float]:
        t = entity.typed_json or {}
        keep = set(METRICS) | {"cost_total", "slot_count"}   # the two divisors the per-cost / per-supply metrics need
        base = {k: float(v) for k, v in t.items() if k in keep and isinstance(v, (int, float)) and not isinstance(v, bool)}
        if "ehp" in base:
            base["ehp_frontal"] = base["ehp"]   # same number until a forward-arc modifier applies
        return base


HEADLINE = ["dps_total", "ehp", "ehp_frontal", "speed", "max_range"]


def apply_modifiers(base: dict[str, float], totals: dict[str, float]) -> dict[str, float]:
    """Re-derive the typed metrics with summed modifier fractions applied."""
    out = dict(base)
    pct = lambda t: 1.0 + totals.get(t, 0.0)   # noqa: E731
    for key, (metric, mode, _label) in MODIFIERS.items():
        if key not in totals or metric not in out:
            continue
        out[metric] = out[metric] + totals[key] if mode == "add" else out[metric] * pct(key)
    # weapons: damage up, cooldown down -> every DPS figure scales by damage / cooldown
    scale = pct("WeaponDamage") / pct("WeaponCooldown") if pct("WeaponCooldown") > 0 else 0.0
    for k in ("dps_total", "dps_all_banks", "dps_anti_fighter"):
        if k in out:
            out[k] = out[k] * scale
    if "hull" in out:
        out["ehp"] = out["hull"] * (1.0 + out.get("armor", 0.0) * ARMOR_WEIGHT) + out.get("shield", 0.0)
        taken = pct("DamageAsDamageTargetFromForward")
        out["ehp_frontal"] = out["ehp"] / taken if taken > 0 else None   # immune from the front: no finite figure
    cost = base.get("cost_total") or None
    if cost and "dps_total" in out:
        out["dps_per_cost"] = out["dps_total"] / cost
    if cost and "ehp" in out:
        out["ehp_per_cost"] = out["ehp"] / cost
    supply = base.get("slot_count") or None
    if supply and "dps_total" in out:
        out["dps_per_supply"] = out["dps_total"] / supply
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}


def _actions(root: Node, *, top_level: bool = False) -> list[dict[str, Any]]:
    """Buff-applying / other actions declared on an ability (top level) or inside a buff's action blocks."""
    out: list[dict[str, Any]] = []
    blocks = [root] if top_level else root.all("instantAction") + root.all("periodicAction") + root.all("overTimeAction")
    for blk in blocks:
        atype = blk.scalar("buffInstantActionType") or blk.scalar("buffOverTimeActionType") or blk.scalar("buffPeriodicActionType")
        if not atype:
            continue
        cond_type = blk.scalar("instantActionConditionType")
        condition = None
        if cond_type and cond_type != "Invalid":
            condition = {"type": str(cond_type), "values": _levels(_value_after(blk, "instantActionConditionType"))}
        out.append({"type": str(atype), "buff": blk.scalar("buffType") or None, "trigger": blk.scalar("instantActionTriggerType"),
                    "condition": condition})
    return out


def _value_after(block: Node, type_key: str) -> Node | None:
    """The parameter block that follows a ``...Type`` line (``hullPerc``, ``time``...): Sins lays them out in order."""
    kids = block.live_children()
    at = next((i for i, c in enumerate(kids) if c.key == type_key), None)
    if at is None:
        return None
    return next((c for c in kids[at + 1:] if c.is_block and c.indexed("Level")), None)


def _applies_to(action_type: str) -> str:
    if "Self" in action_type:
        return "self"
    if "Spawner" in action_type:
        return "spawner"
    return "target"


def _levels(node: Node | None) -> list[float | None]:
    """``Level:0 .. Level:N`` values of a block, in order; a bare scalar counts as one level."""
    if node is None:
        return []
    if not node.is_block:
        v = node.value
        return [float(v)] if isinstance(v, (int, float)) and not isinstance(v, bool) else []
    idx = node.indexed("Level")
    out: list[float | None] = []
    for k in sorted(idx, key=lambda s: int(s) if s.isdigit() else 0):
        v = idx[k].value
        out.append(float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None)
    return out


def _at_level(values: list[float | None], level: int) -> float | None:
    if not values:
        return None
    return values[min(level, len(values) - 1)]


def _condition_holds(condition: dict[str, Any] | None, hull: float, level: int) -> bool:
    """Only hull-fraction conditions are simulated; anything else counts as not met (the user can force it on)."""
    if not condition:
        return True
    v = _at_level(condition.get("values") or [], level)
    if condition["type"] == "IfOwnerHasHullLessThanPerc":
        return v is not None and hull < v
    if condition["type"] == "IfOwnerHasHullGreaterThanPerc":
        return v is not None and hull > v
    return False


def _delta(a: float | None, b: float | None) -> dict[str, float | None] | None:
    if a is None or b is None:
        return None
    return {"abs": round(b - a, 4), "pct": round((b - a) / a * 100.0, 2) if a else None}

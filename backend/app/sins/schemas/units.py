"""
Typed views for combat units: CapitalShip, Frigate, Fighter and Squad.

The three ship types spell the same stats three different ways
(``MaxHullPoints/StartValue``, ``MaxHullPoints 350.0``, ``maxHullPoints 70.0``);
``fields.stat`` hides that so analytics see one shape.
"""
from __future__ import annotations

from typing import Any

from ..document import Document, Node
from .fields import EntitySchema, cost, specs, stat, stat_growth

BANKS = ("FRONT", "BACK", "LEFT", "RIGHT")

# Heuristic weight of one armour point when estimating effective HP.  Kept as a
# module constant so the balance model can be recalibrated in one place.
ARMOR_WEIGHT = 0.05

_SHIP_FIELDS = specs([
    ("NameStringID", "Name string", "Identity", "ref", {"ref": "string"}),
    ("DescriptionStringID", "Description string", "Identity", "ref", {"ref": "string"}),
    ("statCountType", "Stat category", "Identity", "enum", {"enum": "statCountType"}),
    ("armorType", "Armor class", "Identity", "enum", {"enum": "armorType", "balance": True}),
    ("basePrice.credits", "Credits", "Economy", "float", {"balance": True}),
    ("basePrice.metal", "Metal", "Economy", "float", {"balance": True}),
    ("basePrice.crystal", "Crystal", "Economy", "float", {"balance": True}),
    ("BuildTime", "Build time", "Economy", "float", {"unit": "s", "balance": True}),
    ("slotCount", "Fleet supply", "Economy", "float", {"balance": True}),
    ("ExperiencePointsForDestroying", "XP when destroyed", "Economy", "float", {"balance": True}),
    ("MaxHullPoints", "Hull", "Durability", "stat", {"balance": True}),
    ("MaxShieldPoints", "Shields", "Durability", "stat", {"balance": True}),
    ("HullPointRestoreRate", "Hull regen", "Durability", "stat", {"unit": "/s", "balance": True}),
    ("ShieldPointRestoreRate", "Shield regen", "Durability", "stat", {"unit": "/s", "balance": True}),
    ("BaseArmorPoints", "Armor", "Durability", "float", {"balance": True}),
    ("ArmorPointsFromExperience", "Armor (capital)", "Durability", "stat", {"balance": True}),
    ("maxMitigation", "Max mitigation", "Durability", "stat", {"balance": True}),
    ("MaxAntiMatter", "Antimatter", "Durability", "stat", {"balance": True}),
    ("AntiMatterRestoreRate", "Antimatter regen", "Durability", "stat", {"unit": "/s", "balance": True}),
    ("maxSpeedLinear", "Speed", "Mobility", "float", {"balance": True}),
    ("maxAccelerationLinear", "Acceleration", "Mobility", "float", {"balance": True}),
    ("maxAccelerationStrafe", "Strafe accel", "Mobility", "float"),
    ("maxDecelerationLinear", "Deceleration", "Mobility", "float"),
    ("maxAccelerationAngular", "Turn accel", "Mobility", "float", {"balance": True}),
    ("maxRollRate", "Roll rate", "Mobility", "float"),
    ("maxRollAngle", "Roll angle", "Mobility", "float"),
    ("mass", "Mass", "Mobility", "float", {"balance": True}),
    ("NumWeapons", "Weapon count", "Combat", "int"),
    ("m_weaponIndexForRange", "Range weapon index", "Combat", "int"),
    ("TargetCountPerBank:FRONT", "Targets front", "Combat", "int", {"balance": True}),
    ("TargetCountPerBank:BACK", "Targets back", "Combat", "int", {"balance": True}),
    ("TargetCountPerBank:LEFT", "Targets left", "Combat", "int", {"balance": True}),
    ("TargetCountPerBank:RIGHT", "Targets right", "Combat", "int", {"balance": True}),
    ("canBomb", "Can bomb planets", "Combat", "bool"),
    ("canOnlyTargetStructures", "Only targets structures", "Combat", "bool"),
    ("ability:0", "Ability 1", "Ability", "ref", {"ref": "entity"}),
    ("ability:1", "Ability 2", "Ability", "ref", {"ref": "entity"}),
    ("ability:2", "Ability 3", "Ability", "ref", {"ref": "entity"}),
    ("ability:3", "Ability 4", "Ability", "ref", {"ref": "entity"}),
    ("ability:4", "Passive ability", "Ability", "ref", {"ref": "entity"}),
    ("squadTypeEntityDef:0", "Squad 1", "Fleet", "ref", {"ref": "entity"}),
    ("squadTypeEntityDef:1", "Squad 2", "Fleet", "ref", {"ref": "entity"}),
    ("squadTypeEntityDef:2", "Squad 3", "Fleet", "ref", {"ref": "entity"}),
    ("squadTypeEntityDef:3", "Squad 4", "Fleet", "ref", {"ref": "entity"}),
    ("maxNumCommandPoints", "Command points", "Fleet", "int"),
    ("CommandPoints", "Command points (capital)", "Fleet", "stat"),
    ("Prerequisites.ResearchPrerequisite[0].Subject", "Unlock research", "Research", "ref", {"ref": "entity"}),
    ("MeshNameInfo[0].meshName", "Mesh", "Visual", "ref", {"ref": "mesh"}),
    ("ShieldMeshName", "Shield mesh", "Visual", "ref", {"ref": "mesh"}),
    ("ExhaustParticleSystemName", "Exhaust particle", "Visual", "ref", {"ref": "particle"}),
    ("ExplosionName", "Explosion", "Visual", "ref", {"ref": "explosion"}),
    ("hudIcon", "HUD icon", "Visual", "ref", {"ref": "brush"}),
    ("smallHudIcon", "Small HUD icon", "Visual", "ref", {"ref": "brush"}),
    ("infoCardIcon", "Info card icon", "Visual", "ref", {"ref": "brush"}),
    ("mainViewIcon", "Main view icon", "Visual", "ref", {"ref": "brush"}),
    ("picture", "Picture", "Visual", "ref", {"ref": "brush"}),
    ("EngineSoundID", "Engine sound", "Audio", "ref", {"ref": "sound"}),
    ("defaultAutoAttackRange", "Auto-attack range", "AI", "enum", {"enum": "autoAttackRange"}),
    ("prefersToFocusFire", "Prefers focus fire", "AI", "bool"),
    ("autoJoinFleetDefault", "Auto-join fleet", "AI", "bool"),
])

_FIGHTER_FIELDS = specs([
    ("nameStringID", "Name string", "Identity", "ref", {"ref": "string"}),
    ("counterDescriptionStringID", "Counter description", "Identity", "ref", {"ref": "string"}),
    ("statCountType", "Stat category", "Identity", "enum", {"enum": "statCountType"}),
    ("armorType", "Armor class", "Identity", "enum", {"enum": "armorType", "balance": True}),
    ("maxHullPoints", "Hull", "Durability", "float", {"balance": True}),
    ("hullPointRestoreRate", "Hull regen", "Durability", "float", {"balance": True}),
    ("armorPoints", "Armor", "Durability", "float", {"balance": True}),
    ("maxMitigation", "Max mitigation", "Durability", "float"),
    ("experiencePointsForDestroying", "XP when destroyed", "Economy", "float"),
    ("maxSpeedLinear", "Speed", "Mobility", "float", {"balance": True}),
    ("maxAccelerationLinear", "Acceleration", "Mobility", "float", {"balance": True}),
    ("maxAccelerationAngular", "Turn accel", "Mobility", "float"),
    ("mass", "Mass", "Mobility", "float"),
    ("formationOffsetDistance", "Formation spacing", "Mobility", "float"),
    ("NumWeapons", "Weapon count", "Combat", "int"),
    ("meshName", "Mesh", "Visual", "ref", {"ref": "mesh"}),
    ("exhaustParticleSystemName", "Exhaust particle", "Visual", "ref", {"ref": "particle"}),
    ("exhaustTrailTextureName", "Exhaust trail texture", "Visual", "ref", {"ref": "texture"}),
    ("ExplosionName", "Explosion", "Visual", "ref", {"ref": "explosion"}),
    ("engineSoundID", "Engine sound", "Audio", "ref", {"ref": "sound"}),
])

_SQUAD_FIELDS = specs([
    ("nameStringID", "Name string", "Identity", "ref", {"ref": "string"}),
    ("descriptionStringID", "Description string", "Identity", "ref", {"ref": "string"}),
    ("role", "Role", "Identity", "enum", {"enum": "squadRole"}),
    ("statCountType", "Stat category", "Identity", "enum", {"enum": "statCountType"}),
    ("fighterEntityDef", "Fighter", "Squad", "ref", {"ref": "entity"}),
    ("fighterIllusionEntityDef", "Illusion fighter", "Squad", "ref", {"ref": "entity"}),
    ("baseMaxNumFighters", "Fighters per squad", "Squad", "int", {"balance": True}),
    ("fighterConstructionTime", "Fighter build time", "Squad", "float", {"unit": "s", "balance": True}),
    ("scuttleTime", "Scuttle time", "Squad", "float"),
    ("decayWithoutOwnerRate", "Decay without owner", "Squad", "float"),
    ("launchIcon", "Launch icon", "Visual", "ref", {"ref": "brush"}),
    ("dockIcon", "Dock icon", "Visual", "ref", {"ref": "brush"}),
])

CAPITAL_SCHEMA = EntitySchema("CapitalShip", "ship", _SHIP_FIELDS, ("entityType", "NumWeapons", "MeshNameInfoCount"))
FRIGATE_SCHEMA = EntitySchema("Frigate", "ship", _SHIP_FIELDS, ("entityType", "NumWeapons", "MeshNameInfoCount"))
FIGHTER_SCHEMA = EntitySchema("Fighter", "ship", _FIGHTER_FIELDS, ("entityType", "NumWeapons", "meshName"),
                              name_key="nameStringID", desc_key="counterDescriptionStringID")
SQUAD_SCHEMA = EntitySchema("Squad", "squad", _SQUAD_FIELDS, ("entityType", "fighterEntityDef"),
                            name_key="nameStringID", desc_key="descriptionStringID")


def _f(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def extract_weapons(doc: Document) -> list[dict[str, Any]]:
    """One dict per ``Weapon`` block with damage, timing and effect names."""
    out: list[dict[str, Any]] = []
    for i, w in enumerate(doc.root.all("Weapon")):
        enums = w.get("damageEnums")
        fx = w.get("WeaponEffects")
        banks = {b: _f(w.scalar(f"DamagePerBank:{b}")) or 0.0 for b in BANKS}
        cooldown = _f(w.scalar("PreBuffCooldownTime")) or 0.0
        burst = int(fx.scalar("burstCount") or 1) if fx is not None else 1
        row: dict[str, Any] = {
            "weapon_index": i,
            "weapon_type": w.scalar("WeaponType"),
            "attack_type": enums.scalar("AttackType") if enums else None,
            "damage_affect_type": enums.scalar("DamageAffectType") if enums else None,
            "damage_apply_type": enums.scalar("DamageApplyType") if enums else None,
            "damage_type": enums.scalar("DamageType") if enums else None,
            "weapon_class": enums.scalar("WeaponClassType") if enums else None,
            "damage_front": banks["FRONT"], "damage_back": banks["BACK"],
            "damage_left": banks["LEFT"], "damage_right": banks["RIGHT"],
            "range": _f(w.scalar("Range")),
            "cooldown": cooldown,
            "travel_speed": _f(w.scalar("TravelSpeed")),
            "duration": _f(w.scalar("Duration")),
            "point_stagger_delay": _f(w.scalar("PointStaggerDelay")),
            "can_fire_at_fighter": bool(w.scalar("CanFireAtFighter")),
            "synchronized_targeting": bool(w.scalar("SynchronizedTargeting")),
            "fire_constraint": w.scalar("fireConstraintType"),
            "burst_count": burst,
            "burst_delay": _f(fx.scalar("burstDelay")) if fx else None,
            "fire_delay": _f(fx.scalar("fireDelay")) if fx else None,
            "muzzle_effect": fx.scalar("muzzleEffectName") if fx else None,
            "hit_effect": fx.scalar("hitEffectName") if fx else None,
            "travel_effect": (fx.scalar("projectileTravelEffectName") or fx.scalar("missileTravelEffectName")) if fx else None,
        }
        # sustained single-target DPS of the strongest bank, and of every bank combined
        best = max(banks.values()) if banks else 0.0
        row["dps_best_bank"] = (best * burst / cooldown) if cooldown > 0 else 0.0
        row["dps_all_banks"] = (sum(banks.values()) * burst / cooldown) if cooldown > 0 else 0.0
        out.append(row)
    return out


def extract_unit(doc: Document) -> dict[str, Any]:
    """Flat stat row shared by CapitalShip / Frigate / Fighter."""
    price = cost(doc, "basePrice")
    weapons = extract_weapons(doc)
    hull = stat(doc, "MaxHullPoints") or 0.0
    shield = stat(doc, "MaxShieldPoints") or 0.0
    armor = stat(doc, "BaseArmorPoints")
    if armor is None:
        armor = stat(doc, "ArmorPointsFromExperience")
    if armor is None:
        armor = stat(doc, "armorPoints")
    row: dict[str, Any] = {
        "role": doc.scalar("frigateRoleType") or doc.scalar("roleType") or doc.scalar("role"),
        "stat_count_type": doc.scalar("statCountType"),
        "armor_type": doc.scalar("armorType"),
        "credits": price["credits"], "metal": price["metal"], "crystal": price["crystal"],
        "build_time": _f(doc.scalar("BuildTime")),
        "slot_count": _f(doc.scalar("slotCount")),
        "xp_for_destroying": stat(doc, "ExperiencePointsForDestroying"),
        "hull": hull, "shield": shield, "armor": armor or 0.0,
        "hull_regen": stat(doc, "HullPointRestoreRate") or 0.0,
        "shield_regen": stat(doc, "ShieldPointRestoreRate") or 0.0,
        "mitigation": stat(doc, "maxMitigation") or 0.0,
        "antimatter": stat(doc, "MaxAntiMatter") or 0.0,
        "antimatter_regen": stat(doc, "AntiMatterRestoreRate") or 0.0,
        "hull_growth": stat_growth(doc, "MaxHullPoints"),
        "shield_growth": stat_growth(doc, "MaxShieldPoints"),
        "speed": _f(doc.scalar("maxSpeedLinear")),
        "acceleration": _f(doc.scalar("maxAccelerationLinear")),
        "turn_rate": _f(doc.scalar("maxAccelerationAngular")),
        "mass": _f(doc.scalar("mass")),
        "weapon_count": len(weapons),
        "dps_total": round(sum(w["dps_best_bank"] for w in weapons), 3),
        "dps_all_banks": round(sum(w["dps_all_banks"] for w in weapons), 3),
        "dps_anti_fighter": round(sum(w["dps_best_bank"] for w in weapons if w["can_fire_at_fighter"]), 3),
        "max_range": max((w["range"] or 0.0 for w in weapons), default=0.0),
        "can_bomb": bool(doc.scalar("canBomb")),
        "squads": [n.value for n in doc.root.all("squadTypeEntityDef") if n.value],
        "abilities": [n.value for n in doc.root.all("ability") if n.value],
    }
    row["cost_total"] = price["credits"] + price["metal"] + price["crystal"]
    # Effective HP: the engine's exact armour curve is not exposed in data files,
    # so hull is weighted by a tunable per-point factor (see ARMOR_WEIGHT).
    row["ehp"] = round(hull * (1.0 + row["armor"] * ARMOR_WEIGHT) + shield, 2)
    row["ehp_per_cost"] = round(row["ehp"] / row["cost_total"], 4) if row["cost_total"] else None
    row["dps_per_cost"] = round(row["dps_total"] / row["cost_total"], 4) if row["cost_total"] else None
    row["dps_per_supply"] = round(row["dps_total"] / row["slot_count"], 3) if row["slot_count"] else None
    return row


def extract_squad(doc: Document) -> dict[str, Any]:
    return {
        "role": doc.scalar("role"),
        "stat_count_type": doc.scalar("statCountType"),
        "fighter": doc.scalar("fighterEntityDef"),
        "fighters_per_squad": doc.scalar("baseMaxNumFighters"),
        "fighter_build_time": _f(doc.scalar("fighterConstructionTime")),
    }

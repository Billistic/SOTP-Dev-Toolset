"""Typed views for Ability and Buff entities, plus the Player faction definition."""
from __future__ import annotations

from typing import Any

from ..document import Document, Node
from .fields import EntitySchema, level_table, specs

# Abilities and buffs are laid out from the Rebellion grammar (sins/grammar.py), block by block; the curated
# list is kept to the two string fields so the form still shows the localised text up front.
ABILITY_SCHEMA = EntitySchema("Ability", "ability", specs([
    ("nameStringID", "Name string", "Identity", "ref", {"ref": "string"}),
    ("descStringID", "Description string", "Identity", "ref", {"ref": "string"}),
]), required=("entityType", "buffInstantActionType"), name_key="nameStringID", desc_key="descStringID")

BUFF_SCHEMA = EntitySchema("Buff", "buff", [], required=("entityType", "numInstantActions", "numFinishConditions"), name_key="", desc_key="")

PLAYER_SCHEMA = EntitySchema("Player", "player", specs([
    ("raceNameStringID", "Race name string", "Identity", "ref", {"ref": "string"}),
    ("playerRaceType", "Race type", "Identity", "enum", {"enum": "playerRaceType"}),
    ("isSelectable", "Selectable", "Identity", "bool"),
    ("canColonize", "Can colonize", "Identity", "bool"),
    ("entities.flagship", "Flagship", "Fleet", "ref", {"ref": "entity"}),
    ("hyperspaceData.baseHyperspaceSpeed", "Hyperspace speed", "Mobility", "float", {"balance": True}),
    ("hyperspaceData.baseHyperspaceChargeUpTime", "Hyperspace charge time", "Mobility", "float", {"balance": True}),
    ("hyperspaceData.hyperspaceSpeedBetweenStarsMultiplier", "Interstellar multiplier", "Mobility", "float", {"balance": True}),
    ("shieldData.shieldAbsorbBaseMin", "Shield absorb min", "Durability", "float", {"balance": True}),
    ("shieldData.shieldAbsorbGrowthPerDamage", "Shield absorb growth", "Durability", "float"),
    ("shieldData.shieldAbsorbDecayRate", "Shield absorb decay", "Durability", "float"),
    ("shieldData.shieldColor", "Shield colour", "Visual", "color"),
]), required=("entityType", "entities"), name_key="raceNameStringID", desc_key="")


def _levels(node: Node | None, key: str) -> dict[int, float]:
    return level_table(node.get(key)) if node is not None else {}


def extract_ability(doc: Document) -> dict[str, Any]:
    return {
        "action_type": doc.scalar("buffInstantActionType"),
        "buff": doc.scalar("buffType"),
        "levels": doc.scalar("maxNumLevels"),
        "range": level_table(doc.get("range")),
        "cooldown": level_table(doc.get("cooldownTime")),
        "antimatter_cost": level_table(doc.get("antiMatterCost")),
        "is_ultimate": bool(doc.scalar("isUltimateAbility")),
        "autocast": bool(doc.scalar("isAutoCastAvailable")),
    }


def extract_buff(doc: Document) -> dict[str, Any]:
    actions = []
    for kind in ("instantAction", "periodicAction", "OverTimeAction", "entityModifier", "entityBoolModifier"):
        for a in doc.root.all(kind):
            typ = (a.scalar("buffInstantActionType") or a.scalar("buffPeriodicActionType")
                   or a.scalar("buffOverTimeActionType") or a.scalar("buffEntityModifierType")
                   or a.scalar("buffEntityBoolModifierType"))
            actions.append({"kind": kind, "type": typ,
                            "values": {c.key: level_table(c) for c in a.live_children() if c.is_block and c.indexed("Level")}})
    return {
        "stacking_limit": doc.scalar("stackingLimit"),
        "actions": actions,
        "finish_conditions": [fc.scalar("finishConditionType") for fc in doc.root.all("finishCondition")],
    }


PLAYER_SLOTS = {"planetModuleInfo": "module", "titanInfo": "titan", "capitalShipInfo": "capitalShip",
                "frigateInfo": "frigate", "researchInfo": "research", "starBaseInfo": "starBase"}


def extract_player_members(doc: Document) -> list[dict[str, Any]]:
    """Every entity a Player can build/research: (slot kind, page, ordinal, name)."""
    ents = doc.get("entities")
    if ents is None:
        return []
    out: list[dict[str, Any]] = []
    for info_key, slot in PLAYER_SLOTS.items():
        info = ents.get(info_key)
        if info is None:
            continue
        pages = [c for c in info.live_children() if c.is_block] or [info]
        for page in pages:
            page_label = page.suffix if page.base_key == "Page" else (page.key if page is not info else None)
            for i, e in enumerate(page.all("entityDefName")):
                if e.value:
                    out.append({"slot": slot, "page": page_label, "ordinal": i, "name": e.value})
    flagship = ents.scalar("flagship")
    if flagship:
        out.append({"slot": "flagship", "page": None, "ordinal": 0, "name": flagship})
    return out

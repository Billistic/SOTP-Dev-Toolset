"""Typed views for planet modules (all five PlanetModule* types) and planets."""
from __future__ import annotations

from typing import Any

from ..document import Document
from .fields import EntitySchema, cost, specs, stat

_MODULE_FIELDS = specs([
    ("NameStringID", "Name string", "Identity", "ref", {"ref": "string"}),
    ("DescriptionStringID", "Description string", "Identity", "ref", {"ref": "string"}),
    ("planetModuleRoleType", "Role", "Identity", "enum", {"enum": "planetModuleRoleType"}),
    ("statCountType", "Stat category", "Identity", "enum", {"enum": "statCountType"}),
    ("armorType", "Armor class", "Identity", "enum", {"enum": "armorType", "balance": True}),
    ("planetUpgradeSlotType", "Slot type", "Module", "enum", {"enum": "planetUpgradeSlotType"}),
    ("planetUpgradeSlotCount", "Slots used", "Module", "float", {"balance": True}),
    ("basePrice.credits", "Credits", "Economy", "float", {"balance": True}),
    ("basePrice.metal", "Metal", "Economy", "float", {"balance": True}),
    ("basePrice.crystal", "Crystal", "Economy", "float", {"balance": True}),
    ("baseBuildTime", "Build time", "Economy", "float", {"unit": "s", "balance": True}),
    ("ExperiencePointsForDestroying", "XP when destroyed", "Economy", "float"),
    ("MaxHullPoints", "Hull", "Durability", "stat", {"balance": True}),
    ("MaxShieldPoints", "Shields", "Durability", "stat", {"balance": True}),
    ("HullPointRestoreRate", "Hull regen", "Durability", "stat", {"balance": True}),
    ("ShieldPointRestoreRate", "Shield regen", "Durability", "stat", {"balance": True}),
    ("BaseArmorPoints", "Armor", "Durability", "float", {"balance": True}),
    ("maxShieldMitigation", "Max shield mitigation", "Durability", "float"),
    ("MaxAntiMatter", "Antimatter", "Durability", "stat"),
    ("AntiMatterRestoreRate", "Antimatter regen", "Durability", "stat"),
    ("cultureSpreadRate", "Culture spread", "Module", "float", {"balance": True}),
    ("resourceExtractionType", "Extracts", "Module", "enum", {"enum": "resourceExtractionType"}),
    ("baseTradeIncomeRate", "Trade income", "Module", "float", {"balance": True}),
    ("maxCargoShipCount", "Cargo ships", "Module", "int", {"balance": True}),
    ("cargoShipType", "Cargo ship", "Module", "ref", {"ref": "entity"}),
    ("baseCommandPoints", "Command points", "Module", "int"),
    ("placementRadius", "Placement radius", "Module", "float"),
    ("spawnCount", "Spawn count", "Module", "float"),
    ("isAffectedBySimilarModuleCostResearch", "Cost scales with count", "Module", "bool"),
    ("Prerequisites.ResearchPrerequisite[0].Subject", "Unlock research", "Research", "ref", {"ref": "entity"}),
    ("MeshNameInfo[0].meshName", "Mesh", "Visual", "ref", {"ref": "mesh"}),
    ("ShieldMeshName", "Shield mesh", "Visual", "ref", {"ref": "mesh"}),
    ("ExplosionName", "Explosion", "Visual", "ref", {"ref": "explosion"}),
    ("buildEffectName", "Build effect", "Visual", "ref", {"ref": "particle"}),
    ("hudIcon", "HUD icon", "Visual", "ref", {"ref": "brush"}),
    ("smallHudIcon", "Small HUD icon", "Visual", "ref", {"ref": "brush"}),
    ("infoCardIcon", "Info card icon", "Visual", "ref", {"ref": "brush"}),
    ("mainViewIcon", "Main view icon", "Visual", "ref", {"ref": "brush"}),
    ("picture", "Picture", "Visual", "ref", {"ref": "brush"}),
    ("rotateSoundName", "Rotate sound", "Audio", "ref", {"ref": "sound"}),
])

MODULE_TYPES = ("PlanetModuleStandard", "PlanetModuleHangarDefense", "PlanetModuleShipFactory",
                "PlanetModuleTradePort", "PlanetModuleRefinery")
MODULE_SCHEMAS = {t: EntitySchema(t, "module", _MODULE_FIELDS, ("entityType", "MeshNameInfoCount", "basePrice"))
                  for t in MODULE_TYPES}

PLANET_SCHEMA = EntitySchema("Planet", "planet", specs([
    ("typeNameStringID", "Type name string", "Identity", "ref", {"ref": "string"}),
    ("planetTypeForResearch", "Research planet type", "Identity", "enum", {"enum": "planetTypeForResearch"}),
    ("isColonizable", "Colonizable", "Planet", "bool"),
    ("isAsteroid", "Is asteroid", "Planet", "bool"),
    ("isWormhole", "Is wormhole", "Planet", "bool"),
    ("moveAreaRadius", "Gravity well radius", "Planet", "float", {"balance": True}),
    ("hyperspaceExitRadius", "Hyperspace exit radius", "Planet", "float"),
    ("maxStarBaseCountPerPlayer", "Starbases per player", "Planet", "int", {"balance": True}),
    ("maxSpaceMineCountPerPlayer", "Mines per player", "Planet", "int"),
    ("healthRegenRate", "Health regen", "Planet", "float", {"balance": True}),
    ("planetResourceSetupInfo.totalMaxResourceAsteroids", "Max resource asteroids", "Planet", "int", {"balance": True}),
    ("ambienceSoundID", "Ambience sound", "Audio", "ref", {"ref": "sound"}),
    ("meshInfo[0].meshName", "Mesh", "Visual", "ref", {"ref": "mesh"}),
    ("cloudLayerTextureName", "Cloud texture", "Visual", "ref", {"ref": "texture"}),
    ("hudIcon", "HUD icon", "Visual", "ref", {"ref": "brush"}),
    ("mainViewIcon", "Main view icon", "Visual", "ref", {"ref": "brush"}),
    ("picture", "Picture", "Visual", "ref", {"ref": "brush"}),
]), required=("entityType", "planetUpgradeDef"), name_key="typeNameStringID", desc_key="")


def extract_module(doc: Document) -> dict[str, Any]:
    price = cost(doc, "basePrice")
    return {
        "role": doc.scalar("planetModuleRoleType"),
        "stat_count_type": doc.scalar("statCountType"),
        "armor_type": doc.scalar("armorType"),
        "slot_type": doc.scalar("planetUpgradeSlotType"),
        "slot_count": doc.scalar("planetUpgradeSlotCount"),
        "credits": price["credits"], "metal": price["metal"], "crystal": price["crystal"],
        "cost_total": price["credits"] + price["metal"] + price["crystal"],
        "build_time": doc.scalar("baseBuildTime"),
        "hull": stat(doc, "MaxHullPoints") or 0.0,
        "shield": stat(doc, "MaxShieldPoints") or 0.0,
        "armor": stat(doc, "BaseArmorPoints") or 0.0,
        "hull_regen": stat(doc, "HullPointRestoreRate") or 0.0,
        "shield_regen": stat(doc, "ShieldPointRestoreRate") or 0.0,
        "culture_spread": doc.scalar("cultureSpreadRate"),
        "extraction_type": doc.scalar("resourceExtractionType"),
        "trade_income": doc.scalar("baseTradeIncomeRate"),
        "cargo_ships": doc.scalar("maxCargoShipCount"),
        "weapon_count": len(doc.root.all("Weapon")),
    }


def extract_planet(doc: Document) -> dict[str, Any]:
    upgrades = doc.get("planetUpgradeDef")
    paths: dict[str, int] = {}
    if upgrades is not None:
        for p in upgrades.all("path"):
            paths[p.suffix or p.key] = len(p.all("stage"))
    return {
        "type_name": doc.scalar("typeNameStringID"),
        "research_type": doc.scalar("planetTypeForResearch"),
        "colonizable": bool(doc.scalar("isColonizable")),
        "is_asteroid": bool(doc.scalar("isAsteroid")),
        "gravity_well_radius": doc.scalar("moveAreaRadius"),
        "max_resource_asteroids": doc.scalar("planetResourceSetupInfo.totalMaxResourceAsteroids"),
        "upgrade_paths": paths,
    }

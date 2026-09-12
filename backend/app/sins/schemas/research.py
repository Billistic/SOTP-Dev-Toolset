"""Typed view for ResearchSubject entities."""
from __future__ import annotations

from typing import Any

from ..document import Document
from .fields import EntitySchema, cost, specs

RESEARCH_SCHEMA = EntitySchema("ResearchSubject", "research", specs([
    ("NameStringID", "Name string", "Identity", "ref", {"ref": "string"}),
    ("DescriptionStringID", "Description string", "Identity", "ref", {"ref": "string"}),
    ("ResearchField", "Field", "Research", "enum", {"enum": "researchField"}),
    ("Tier", "Tier", "Research", "int", {"balance": True}),
    ("researchWindowLocation.block", "Window block", "Research", "int"),
    ("researchWindowLocation.pos", "Window position", "Research", "array"),
    ("MaxNumResearchLevels", "Max levels", "Research", "int", {"balance": True}),
    ("BaseUpgradeTime", "Base time", "Economy", "float", {"unit": "s", "balance": True}),
    ("PerLevelUpgradeTime", "Time per level", "Economy", "float", {"unit": "s", "balance": True}),
    ("BaseCost.credits", "Credits", "Economy", "float", {"balance": True}),
    ("BaseCost.metal", "Metal", "Economy", "float", {"balance": True}),
    ("BaseCost.crystal", "Crystal", "Economy", "float", {"balance": True}),
    ("PerLevelCostIncrease.credits", "Credits per level", "Economy", "float", {"balance": True}),
    ("PerLevelCostIncrease.metal", "Metal per level", "Economy", "float", {"balance": True}),
    ("PerLevelCostIncrease.crystal", "Crystal per level", "Economy", "float", {"balance": True}),
    ("priority", "AI priority", "AI", "float"),
    ("onlyWorksIfTierLabsExist", "Requires tier labs", "Research", "bool"),
    ("MinimumArtifactLevel", "Min artifact level", "Research", "int"),
    ("hudIcon", "HUD icon", "Visual", "ref", {"ref": "brush"}),
    ("smallHudIcon", "Small HUD icon", "Visual", "ref", {"ref": "brush"}),
    ("artifactPicture", "Artifact picture", "Visual", "ref", {"ref": "brush"}),
    ("uniqueOverlayBrush", "Overlay brush", "Visual", "ref", {"ref": "brush"}),
]), required=("entityType", "ResearchField", "Tier", "BaseCost", "researchWindowLocation"))


def extract_research(doc: Document) -> dict[str, Any]:
    base = cost(doc, "BaseCost")
    per = cost(doc, "PerLevelCostIncrease")
    pos = doc.scalar("researchWindowLocation.pos")
    return {
        "field": doc.scalar("ResearchField"),
        "tier": doc.scalar("Tier"),
        "max_levels": doc.scalar("MaxNumResearchLevels"),
        "base_time": doc.scalar("BaseUpgradeTime"),
        "per_level_time": doc.scalar("PerLevelUpgradeTime"),
        "credits": base["credits"], "metal": base["metal"], "crystal": base["crystal"],
        "per_level_credits": per["credits"], "per_level_metal": per["metal"], "per_level_crystal": per["crystal"],
        "cost_total": base["credits"] + base["metal"] + base["crystal"],
        "window_block": doc.scalar("researchWindowLocation.block"),
        "window_x": pos[0] if isinstance(pos, list) and len(pos) > 0 else None,
        "window_y": pos[1] if isinstance(pos, list) and len(pos) > 1 else None,
        "priority": doc.scalar("priority"),
        "float_modifier_count": doc.scalar("researchFloatModifiers") or 0,
        "bool_modifier_count": doc.scalar("researchBoolModifiers") or 0,
    }


def extract_modifiers(doc: Document) -> list[dict[str, Any]]:
    """Every ``researchModifier`` block in file order, tagged bool/float by position."""
    out: list[dict[str, Any]] = []
    mode = "float"
    for child in doc.root.live_children():
        if child.base_key == "researchBoolModifiers":
            mode = "bool"
        elif child.base_key == "researchFloatModifiers":
            mode = "float"
        elif child.base_key == "researchModifier":
            out.append({
                "index": len(out),
                "modifier_type": child.scalar("modifierType"),
                "base_value": child.scalar("baseValue"),
                "per_level_value": child.scalar("perLevelValue"),
                "is_bool": mode == "bool",
            })
    return out


def extract_prerequisites(doc: Document) -> list[dict[str, Any]]:
    """``Prerequisites`` / ``researchPrerequisites`` entries for any entity type."""
    block = doc.get("Prerequisites") or doc.get("researchPrerequisites")
    if block is None:
        return []
    out = []
    for i, p in enumerate(block.all("ResearchPrerequisite")):
        subject = p.scalar("Subject")
        if subject:
            out.append({"index": i, "subject": subject, "level": p.scalar("Level") or 0})
    return out

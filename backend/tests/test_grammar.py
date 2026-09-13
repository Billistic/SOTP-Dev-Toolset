"""The Rebellion entity grammar: loading, layout of real files, templates, extensions and diagnostics hooks."""
from pathlib import Path

import pytest

from app.sins import parse
from app.sins.grammar import Grammar, grammar
from app.sins.schemas.references import extract_references, reference_kinds


@pytest.fixture(scope="module")
def g() -> Grammar:
    return grammar()


def _doc(gameinfo: Path, name: str):
    return parse((gameinfo / f"{name}.entity").read_bytes().decode("utf-8-sig", errors="replace"))


def _slots(layout, title):
    sec = next(s for s in layout["sections"] if s["title"] == title)
    return sec, {s["key"]: s for s in sec["slots"]}


def test_grammar_loads_every_entity_type(g):
    for t in ("Frigate", "CapitalShip", "Fighter", "Squad", "ResearchSubject", "Planet", "Ability", "Buff", "Player",
              "PlanetModuleStandard", "Titan", "StarBase"):
        assert g.entity(t) is not None, t
    assert "WeaponCooldown" in g.enums["buffEntityModifierType"]
    assert "ApplyBuffToSelf" in g.condition_fields["buffInstantActionType"].values
    # the 1.8 extensions landed inside existing structures (Player's nested gameEventData too)
    frigate_keys = [getattr(i, "name", None) for i in g.entity("Frigate").items]
    assert "useCustomHyperspaceEffects" in frigate_keys and frigate_keys.index("useCustomHyperspaceEffects") == frigate_keys.index("maxRollAngle") + 1
    assert "Phase" in g.enums.get("playerRaceType", ()) or any(getattr(i, "name", None) == "playerRaceType" for i in g.entity("Player").items)


def test_buff_layout_follows_conditions(g, gameinfo):
    lay = g.layout(_doc(gameinfo, "Buff_None_CombatDamage50"))
    assert lay["known"] and [s["title"] for s in lay["sections"]][:2] == ["Buff", "periodicAction"]
    root, slots = _slots(lay, "Buff")
    assert slots["entityType"]["readonly"] and root["unknown"] == []
    assert slots["numPeriodicActions"]["kind"] == "count" and slots["numPeriodicActions"]["occurrences"] == 1
    assert slots["numInstantActions"]["itemTemplate"].startswith("instantAction\n\tbuffInstantActionType")
    periodic, ps = _slots(lay, "periodicAction")
    assert periodic["subtitle"] == "Infinite" and periodic["path"] == "periodicAction"
    # the condition chain: actionCountType -> buffInstantActionType -> trigger -> condition -> hullPerc, then buffType / effectInfo
    assert [s["key"] for s in periodic["slots"]] == ["actionCountType", "actionIntervalTime", "buffInstantActionType", "instantActionTriggerType",
                                                      "instantActionConditionType", "hullPerc", "buffType", "effectInfo"]
    assert ps["hullPerc"]["kind"] == "levels" and [v["raw"] for v in ps["hullPerc"]["values"]] == ["0.250000"] * 4
    assert ps["buffType"]["ref"] == "entity" and ps["instantActionTriggerType"]["switch"] is True
    assert "OnDelay" in ps["instantActionTriggerType"]["options"]
    mod, ms = _slots(lay, "entityModifier")
    assert mod["subtitle"] == "WeaponCooldown" and ms["value"]["kind"] == "levels"


def test_ability_layout_marks_optional_and_legacy(g, gameinfo):
    lay = g.layout(_doc(gameinfo, "AbilityUNSCRadiationMAC"))
    root, slots = _slots(lay, "Ability")
    assert slots["toggleStateOnNameStringID"]["present"] is False and slots["toggleStateOnNameStringID"]["required"] is False
    assert slots["useCostType"]["raw"] == '"None"' and slots["cooldownTime"]["kind"] == "levels"
    # the Vanilla-only duplicate of weaponEffectAttachInfo must not show up as a missing block
    assert [s["key"] for s in root["slots"]].count("weaponEffectAttachInfo") == 1
    assert next(s for s in lay["sections"] if s["title"] == "targetFilter")["slots"][1]["options"]   # ownership enum


def test_shared_iterative_keys_split_by_count(g, gameinfo):
    lay = g.layout(_doc(gameinfo, "Research_Cov_Defense_Primary_Damage_Upgrade_All"))
    mods = [s for s in lay["sections"] if s["title"] == "researchModifier"]
    assert len(mods) == 3 and all(m["subtitle"] == "WeaponDamageAdjustment" for m in mods)
    assert all(not s.get("invalid") for m in mods for s in m["slots"])
    assert all(m["unknown"] == [] for m in mods)


def test_invalid_enum_and_unknown_key_are_reported(g):
    doc = parse('TXT\nentityType "Buff"\nonReapplyDuplicateType "Bogus"\nstackingLimit 1\nmadeUpKey 5\nnumInstantActions 0\n')
    lay = g.layout(doc)
    root, slots = _slots(lay, "Buff")
    assert slots["onReapplyDuplicateType"]["invalid"] is True
    assert [u["key"] for u in root["unknown"]] == ["madeUpKey"]
    assert slots["isInterruptable"]["present"] is False and slots["isInterruptable"]["required"] is True
    assert slots["isInterruptable"]["template"] == "isInterruptable FALSE"


def test_templates_are_valid_fragments(g):
    st = g.structures["effectInfo"]
    from app.sins.grammar import _Walker
    text = _Walker(g).template_for(st)
    assert text.splitlines()[0] == "effectInfo" and '\tsoundID ""' in text and "\t\tattachType" in text
    doc = parse("TXT\nentityType \"Buff\"\n" + text + "\n")
    assert doc.get_path("effectInfo.effectAttachInfo.attachType") is not None


def test_grammar_feeds_reference_kinds(g, gameinfo):
    doc = _doc(gameinfo, "Ability_None_CombatPassive")
    kinds = reference_kinds(doc)
    assert kinds["buffType"] == "entity" and kinds["hudIcon"] == "brush" and kinds["nameStringID"] == "string"
    refs = {r.key: r.kind for r in extract_references(doc)}
    assert refs["buffType"] == "entity" and refs["hudIcon"] == "brush"
    # curated tables keep precedence: musicTheme is a music track even though the grammar calls it a Sound
    player = parse('TXT\nentityType "Player"\nmusicThemeData\n\tmusicThemeCount 1\n\tmusicTheme "MUSIC_X"\n')
    assert {r.key: r.kind for r in extract_references(player)}["musicTheme"] == "music"

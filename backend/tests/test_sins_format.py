"""Unit tests for the sins format library using inline fixtures (no corpus needed)."""
from app.sins import parse, write
from app.sins.values import classify, from_python, to_python, Kind
from app.sins.writer import count_mismatches, sync_counts

SHIP = """TXT2
SinsArchiveVersion 194
entityType "Frigate"
NumWeapons 1
Weapon
\tWeaponType "Beam"
\tDamagePerBank:FRONT 65.6
\tDamagePerBank:BACK 0.0
\tfireConstraintType "CanAlwaysFire"
WeaponEffects
\t\tweaponType "Beam"
\tmuzzleEffectName "Muzzle"
\t\tmuzzleSounds
\t\t\tsoundCount 2
\t\t\tsound "A"
\t\t\tsound "B"
CommandPoints
StartValue 0
ValueIncreasePerLevel 0
MaxHullPoints
\tStartValue 600.0
\tValueIncreasePerLevel 0.0
"""


def test_values_roundtrip_classification():
    assert classify('"x"') == Kind.STRING and to_python('"x y"') == "x y"
    assert classify("TRUE") == Kind.BOOL and to_python("FALSE") is False
    assert classify("12") == Kind.INT and classify("-1.5") == Kind.FLOAT
    assert classify("ff1bdbf5") == Kind.HEX and to_python("ff1bdbf5") == "ff1bdbf5"
    assert to_python("[ 50 , 69 , 730 ]") == [50, 69, 730]
    assert to_python("[ 1.0 0.0 4.0 ]") == [1.0, 0.0, 4.0]


def test_from_python_preserves_formatting():
    assert from_python(650, like="600.0") == "650.0"
    assert from_python(1.5, like="1.000000") == "1.500000"
    assert from_python(True) == "TRUE"
    assert from_python("abc") == '"abc"'
    assert from_python([2, 3], like="[ 2, 2 ]") == "[ 2, 3 ]"          # keeps the file's own separator spacing
    assert from_python([2, 3], like="[ 2 , 2 ]") == "[ 2 , 3 ]"
    assert from_python([1.0, 2.0], like="[ 1.0 0.0 ]") == "[ 1.0 2.0 ]"


def test_structure_repairs_generator_indentation():
    doc = parse(SHIP)
    assert doc.header.fmt == "TXT2" and doc.header.archive_version == 194
    weapon = doc.get("Weapon")
    fx = weapon.get("WeaponEffects")
    assert fx is not None, "WeaponEffects at column 0 must be adopted by Weapon"
    assert fx.scalar("muzzleEffectName") == "Muzzle"
    assert [n.value for n in fx.get("muzzleSounds").all("sound")] == ["A", "B"]
    assert doc.scalar("CommandPoints.StartValue") == 0
    assert doc.root.all("StartValue") == []
    assert {k: v.value for k, v in weapon.indexed("DamagePerBank").items()} == {"FRONT": 65.6, "BACK": 0.0}
    assert any(d.code == "INDENT_ADOPTED" for d in doc.diagnostics)


def test_preserve_roundtrip_is_byte_identical():
    assert write(parse(SHIP)) == SHIP


def test_edit_only_touches_changed_lines():
    doc = parse(SHIP)
    doc.get_path("MaxHullPoints.StartValue").set_value(650)
    out = write(doc)
    assert "\tStartValue 650.0\n" in out
    assert out.replace("StartValue 650.0", "StartValue 600.0") == SHIP


def test_pretty_reindents_from_tree():
    out = write(parse(SHIP), "pretty").splitlines()
    assert "\tWeaponEffects" in out
    assert "\t\tmuzzleEffectName \"Muzzle\"" in out
    assert "\tStartValue 0" in out


def test_bom_and_crlf_are_preserved():
    text = "\ufeffTXT\r\nentityType \"Buff\"\r\nnumInstantActions 0\r\n"
    doc = parse(text)
    assert doc.header.bom and doc.header.newline == "\r\n"
    assert doc.entity_type == "Buff"
    assert write(doc) == text


def test_header_with_trailing_space_is_a_block():
    text = "TXT\nPrerequisites\n\tNumResearchPrerequisites 1\n    ResearchPrerequisite  \n        Subject \"R\"\n         Level 1\nRequiredCompletedResearchSubjects 0\n"
    doc = parse(text)
    assert doc.scalar("Prerequisites.ResearchPrerequisite[0].Subject") == "R"
    assert doc.scalar("Prerequisites.ResearchPrerequisite[0].Level") == 1
    assert doc.scalar("Prerequisites.RequiredCompletedResearchSubjects") == 0
    assert write(doc) == text


def test_level_key_with_trailing_colon():
    doc = parse("TXT\ntime\n\tLevel:0: 30.0\n\tLevel:1: 35.0\n")
    assert {k: v.value for k, v in doc.get("time").indexed("Level").items()} == {"0": 30.0, "1": 35.0}


def test_count_sync_and_mismatch():
    doc = parse("TXT\nmuzzleSounds\n\tsoundCount 1\n\tsound \"A\"\n\tsound \"B\"\n")
    (node, declared, actual), = count_mismatches(doc.root)
    assert (declared, actual) == (1, 2)
    assert sync_counts(doc.root) == 1
    assert doc.scalar("muzzleSounds.soundCount") == 2
    assert count_mismatches(doc.root) == []


def test_add_and_remove_children():
    doc = parse("TXT\nmuzzleSounds\n\tsoundCount 1\n\tsound \"A\"\n")
    block = doc.get("muzzleSounds")
    block.add_child("sound", "B")
    sync_counts(doc.root)
    assert write(doc) == "TXT\nmuzzleSounds\n\tsoundCount 2\n\tsound \"A\"\n\tsound \"B\"\n"
    block.all("sound")[0].remove()
    sync_counts(doc.root)
    assert write(doc) == "TXT\nmuzzleSounds\n\tsoundCount 1\n\tsound \"B\"\n"


def test_json_roundtrip():
    from app.sins import Document
    doc = parse(SHIP)
    clone = Document.from_json(doc.to_json())
    assert write(clone, "pretty") == write(doc, "pretty")


def test_json_round_trip_keeps_edited_values():
    from app.sins import Document, parse, write
    doc = parse('TXT\nentityType "Frigate"\nNameStringID "Old_Name"\nMaxHullPoints 100.0\n')
    doc.get_path("NameStringID").set_value("New_Name")
    again = Document.from_json(doc.to_json(include_raw=True))
    assert 'NameStringID "New_Name"' in write(again, "preserve")
    assert "MaxHullPoints 100.0" in write(again, "preserve")

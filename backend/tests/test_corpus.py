"""Tests that run against the real SOTP mod corpus when it is present."""
from pathlib import Path
from app.sins import parse, write
from app.sins.writer import count_mismatches

EXTS = (".entity", ".particle", ".brushes", ".sounddata", ".str", ".manifest", ".constants", ".texanim")


def _files(root: Path):
    skip = {"tools", "Cole's Playground", "Galaxy Forge", "Mesh"}
    return [p for p in root.rglob("*") if p.suffix.lower() in EXTS and not (set(p.parts) & skip)]


def test_every_file_roundtrips_byte_identical(mod_root):
    bad = []
    for p in _files(mod_root):
        raw = p.read_bytes().decode("utf-8", errors="replace")
        if write(parse(raw)) != raw:
            bad.append(p.name)
    assert bad == []


def test_avenar_structure(gameinfo):
    doc = parse((gameinfo / "Capital_COV_Avenar_Regr.entity").read_text(encoding="utf-8-sig"))
    weapons = doc.root.all("Weapon")
    assert len(weapons) == 5 == doc.scalar("NumWeapons")
    assert all(w.get("WeaponEffects") is not None for w in weapons)
    assert doc.root.all("StartValue") == []
    assert doc.scalar("Prerequisites.ResearchPrerequisite[0].Subject") == "Research_Cov_Combat_Avenar_Unlock_Regr"


def test_known_count_mismatch_in_strings(mod_root):
    doc = parse((mod_root / "String" / "English.str").read_text(encoding="utf-8-sig"))
    mism = count_mismatches(doc.root)
    assert [(n.key, a, b) for n, a, b in mism] == [("NumStrings", 889, 890)]

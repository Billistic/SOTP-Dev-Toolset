"""Service-level tests: write-back fidelity (to a scratch folder) and balance filtering."""
import os
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_services.db")

from app.db import SessionLocal, engine, init_db  # noqa: E402
from app.dao import EntityDAO, ProjectDAO  # noqa: E402
from app.services.balance_service import BalanceService  # noqa: E402
from app.services.edit_service import EditService  # noqa: E402
from app.services.export_service import ExportService  # noqa: E402
from app.services.ingest_service import IngestService  # noqa: E402


@pytest.fixture(scope="module")
def db(mod_root: Path, tmp_path_factory):
    for f in Path(".").glob("test_services.db*"):
        f.unlink()
    init_db()
    session = SessionLocal()
    out = tmp_path_factory.mktemp("out")
    project = ProjectDAO(session).create(name="svc", mod_root=str(mod_root), output_root=str(out))
    session.commit()
    IngestService(session).ingest(project)
    yield session, project, out
    session.close()
    engine.dispose()
    for f in Path(".").glob("test_services.db*"):
        try:
            f.unlink()
        except PermissionError:
            pass


def test_write_to_output_root_preserves_untouched_bytes(db, gameinfo):
    session, project, out = db
    name = "Frigate_UNSC_Able_Cole"
    entity = EntityDAO(session).by_name(project.id, name)
    EditService(session).apply(project, entity, [{"op": "set", "path": "MaxHullPoints", "value": 360}])
    path = ExportService(session).write_entity(project, entity)
    session.commit()

    assert path == out / "GameInfo" / f"{name}.entity"
    original = (gameinfo / f"{name}.entity").read_bytes()
    written = path.read_bytes()
    assert written != original
    assert written.replace(b"MaxHullPoints 360.0", b"MaxHullPoints 350.0") == original
    # writing to a separate output root must not clear the editor's dirty flag
    assert entity.is_dirty is True
    assert not (Path(project.mod_root) / "GameInfo" / f"{name}.entity").read_bytes() == written


def test_write_manifest_lists_every_entity(db):
    session, project, out = db
    path = ExportService(session).write_manifest(project)
    lines = path.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "TXT"
    count = int(lines[1].split()[1])
    assert count == len(lines) - 2 == len(EntityDAO(session).all_for_project(project.id))


def test_balance_excludes_placeholders_and_flagship_only_units(db):
    session, project, _ = db
    report = BalanceService(session).recommendations(project, category="ship")
    names = {r["entity"] for r in report["recommendations"]}
    assert not any("placeholder" in n.lower() for n in names)
    assert report["groups"], "expected at least one peer group"
    for rec in report["recommendations"]:
        assert rec["direction"] in ("over-tuned", "under-tuned")
        assert abs(rec["z"]) >= report["zThreshold"]


def test_string_ref_edit_creates_placeholder_string(db):
    session, project, _ = db
    from app.dao import StringDAO
    name = "Frigate_UNSC_Charon_Cole"
    entity = EntityDAO(session).by_name(project.id, name)
    svc = EditService(session)
    svc.apply(project, entity, [{"op": "set", "path": "NameStringID", "value": "Frigate_UNSC_Charon_Test_Name"}])
    assert [s.string_id for s in svc.created_strings] == ["Frigate_UNSC_Charon_Test_Name"]
    row = StringDAO(session).get_by_id(project.id, "Frigate_UNSC_Charon_Test_Name")
    assert row is not None and row.is_new and row.value == "Frigate UNSC Charon Test"
    # pointing at a string that already exists creates nothing
    svc.apply(project, entity, [{"op": "set", "path": "NameStringID", "value": "Frigate_UNSC_Able_Name"}])
    assert svc.created_strings == []
    # a non-string field never triggers it
    svc.apply(project, entity, [{"op": "set", "path": "MaxHullPoints", "value": 123}])
    assert svc.created_strings == []


def test_create_from_template_and_delete(db):
    session, project, out = db
    dao = EntityDAO(session)
    svc = EditService(session)
    new = svc.create(project, "Frigate_UNSC_Zulu_Cole", template="Frigate_UNSC_Able_Cole", own_strings=True)
    assert new.entity_type == "Frigate" and new.is_dirty and new.source_missing
    ids = sorted(s.string_id for s in svc.created_strings)
    assert ids == ["Frigate_UNSC_Zulu_Desc", "Frigate_UNSC_Zulu_Name"]
    from app.sins import Document
    doc = Document.from_json(new.tree_json)
    assert doc.scalar("NameStringID") == "Frigate_UNSC_Zulu_Name"
    assert doc.scalar("DescriptionStringID") == "Frigate_UNSC_Zulu_Desc"
    assert 'DescriptionStringID "Frigate_UNSC_Zulu_Desc"' in svc.render(new)
    # manifest written to the output root lists it, keeps original order and drops nothing else
    path = ExportService(session).write_manifest(project)
    lines = path.read_text(encoding="utf-8").splitlines()
    assert 'entityName "Frigate_UNSC_Zulu_Cole.entity"' in lines
    assert lines[2] == 'entityName "BuffUNSCEclipseLaserDazzling.entity"'
    # delete: no file on disk, so nothing is moved; row is gone
    result = svc.delete(project, new)
    assert result == {"deleted": "Frigate_UNSC_Zulu_Cole", "movedTo": None}
    assert dao.by_name(project.id, "Frigate_UNSC_Zulu_Cole") is None
    assert not (Path(project.mod_root) / ".sotp-trash").exists()


def test_string_delete_is_soft_and_revertable(db):
    session, project, out = db
    from app.dao import StringDAO
    dao = StringDAO(session)
    for c in dao.changes(project.id):   # earlier tests leave placeholder strings behind
        dao.revert(c)
    session.commit()
    row = dao.get_by_id(project.id, "Frigate_UNSC_Able_Name")
    original = row.value
    dao.upsert(project.id, "Frigate_UNSC_Able_Name", "Edited name", row.source_file)
    dao.mark_deleted(dao.get_by_id(project.id, "Frigate_UNSC_Able_Desc"))
    dao.upsert(project.id, "Brand_New_String", "Hello", "String/English.str")
    session.commit()
    changes = dao.changes(project.id)
    kinds = {c.string_id: ("new" if c.is_new else "deleted" if c.is_deleted else "modified") for c in changes}
    assert kinds == {"Frigate_UNSC_Able_Name": "modified", "Frigate_UNSC_Able_Desc": "deleted", "Brand_New_String": "new"}
    # deleted rows vanish from lookups (so references to them become missing) and from the written file
    assert "Frigate_UNSC_Able_Desc" not in dao.id_set(project.id)
    text = ExportService(session).write_strings(project).read_text(encoding="utf-8")
    assert 'ID "Frigate_UNSC_Able_Desc"' not in text and 'ID "Brand_New_String"' in text and 'Value "Edited name"' in text
    assert text.splitlines()[1] == f"NumStrings {text.count('StringInfo')}"
    # output-root write keeps the change tracking; revert-all restores disk state
    assert len(dao.changes(project.id)) == 3
    for c in dao.changes(project.id):
        dao.revert(c)
    session.commit()
    assert dao.changes(project.id) == []
    assert dao.get_by_id(project.id, "Frigate_UNSC_Able_Name").value == original
    assert dao.get_by_id(project.id, "Brand_New_String") is None
    assert dao.get_by_id(project.id, "Frigate_UNSC_Able_Desc").is_deleted is False


def test_weapon_block_ops_clone_move_insert(db):
    session, project, _ = db
    from app.sins import Document
    from app.sins.schemas.weapons import WEAPON_TEMPLATES
    name = "Capital_UNSC_Artemis_Cole"
    entity = EntityDAO(session).by_name(project.id, name)
    svc = EditService(session)
    before = len(entity.weapons)
    svc.apply(project, entity, [
        {"op": "clone", "path": "Weapon[0]"},
        {"op": "move", "path": "Weapon[1]", "offset": 1},
        {"op": "insertText", "parent": "", "text": WEAPON_TEMPLATES["Beam"], "after": f"Weapon[{before}]"},
        {"op": "add", "parent": "Weapon[0].WeaponEffects.muzzleSounds", "key": "sound", "value": "SFX_Test"},
    ])
    doc = Document.from_json(entity.tree_json)
    weapons = doc.root.all("Weapon")
    assert len(weapons) == before + 2 == doc.scalar("NumWeapons")
    assert weapons[-1].scalar("WeaponType") == "Beam" and weapons[-1].scalar("WeaponEffects.beamWidth") == 20.0
    assert weapons[2].scalar("WeaponType") == weapons[0].scalar("WeaponType")   # the clone, moved one down
    assert doc.scalar("Weapon[0].WeaponEffects.muzzleSounds.soundCount") == len(doc.get_path("Weapon[0].WeaponEffects.muzzleSounds").all("sound"))
    assert len(entity.weapons) == before + 2          # weapon rows re-derived
    svc.revert(project, entity)
    assert len(entity.weapons) == before and not entity.is_dirty

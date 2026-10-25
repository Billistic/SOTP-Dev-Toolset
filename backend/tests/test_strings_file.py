"""The .str writer is lossless: only edited Value lines, added / deleted blocks and NumStrings change."""
import os
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_strings_file.db")

from app.db import SessionLocal, dispose_all, init_db, project_session  # noqa: E402
from app.dao import StringDAO  # noqa: E402
from app.models import Project  # noqa: E402
from app.services.export_service import ExportService  # noqa: E402
from app.services.ingest_service import IngestService  # noqa: E402
from app.services.project_registry import ProjectRegistry  # noqa: E402
from app.sins import strings_file  # noqa: E402

# CRLF, no BOM, a duplicate ID (the game keeps the first), space indents, trailing blanks and a blank line
LINES = [
    "TXT",
    "NumStrings 4",
    "StringInfo",
    '\tID "Alpha"',
    '\tValue "First"',
    "StringInfo",
    '    ID "Beta"',
    '  Value "Second"  ',
    "StringInfo",
    '\tID "Alpha"',
    '\tValue "Shadowed"',
    "",
    "StringInfo",
    '\tID "Gamma"',
    '\tValue "Third"',
]
CRLF = "\r\n"
TEXT = CRLF.join(LINES) + CRLF


def _lines(text: str) -> list[str]:
    assert "\n" not in text.replace(CRLF, "")   # no LF-only line endings crept in
    return text.split(CRLF)


# ── pure text edits ─────────────────────────────────────────────────────
def test_no_changes_is_byte_identical():
    assert strings_file.edit(TEXT) == TEXT
    assert strings_file.edit(TEXT, set_values=[("Beta", "Second")]) == TEXT   # same value: nothing to do


def test_editing_one_value_changes_only_that_line():
    out = _lines(strings_file.edit(TEXT, set_values=[("Beta", "Edited")]))
    expected = _lines(TEXT)
    expected[7] = '  Value "Edited"  '   # indent and trailing blanks kept
    assert out == expected


def test_add_appends_in_the_files_style_and_fixes_count():
    out = _lines(strings_file.edit(TEXT, set_values=[("Delta", "Fourth")]))
    expected = _lines(TEXT)
    expected[1] = "NumStrings 5"
    expected[15:15] = ["StringInfo", '\tID "Delta"', '\tValue "Fourth"']
    assert out == expected


def test_delete_removes_only_that_block_and_fixes_count():
    out = _lines(strings_file.edit(TEXT, delete={"Beta"}))
    expected = _lines(TEXT)
    expected[1] = "NumStrings 3"
    del expected[5:8]
    assert out == expected


def test_duplicates_survive_and_only_the_first_is_edited():
    out = strings_file.edit(TEXT, set_values=[("Alpha", "Edited")])
    assert out == TEXT.replace('"First"', '"Edited"')
    assert '\tValue "Shadowed"' in out
    # deleting the ID removes every definition, so the shadowed one cannot resurface
    gone = _lines(strings_file.edit(TEXT, delete={"Alpha"}))
    assert gone[1] == "NumStrings 2" and not any("Alpha" in ln for ln in gone)


def test_bom_lf_and_missing_final_newline_are_kept():
    text = "﻿TXT\nNumStrings 1\nStringInfo\n\tID \"A\"\n\tValue \"a\""
    assert strings_file.edit(text) == text
    assert strings_file.edit(text, set_values=[("B", "b")]) == \
        "﻿TXT\nNumStrings 2\nStringInfo\n\tID \"A\"\n\tValue \"a\"\nStringInfo\n\tID \"B\"\n\tValue \"b\""


# ── ExportService on a tmp mod copy ─────────────────────────────────────
@pytest.fixture()
def mod(tmp_path):
    root = tmp_path / "mod"
    (root / "String").mkdir(parents=True)
    (root / "String" / "English.str").write_bytes(TEXT.encode("utf-8"))
    init_db()
    reg = SessionLocal()
    made: list[tuple[int, object]] = []

    def make(output_root: Path | None = None):
        pid = ProjectRegistry(reg).create(name=f"str{len(made)}", mod_root=str(root),
                                          output_root=str(output_root) if output_root else None).id
        session = project_session(pid)
        made.append((pid, session))
        project = session.get(Project, pid)
        IngestService(session).ingest(project)
        return session, project

    yield root, make
    for pid, session in made:
        session.close()   # an open session keeps the project file locked on Windows
        ProjectRegistry(reg).remove(pid)
    reg.close()
    dispose_all()


def test_in_place_write_is_lossless_and_resets_tracking(mod):
    root, make = mod
    session, project = make()
    path = root / "String" / "English.str"
    dao = StringDAO(session)
    assert dao.get_by_id(project.id, "Alpha").duplicate_count == 2

    ExportService(session).write_strings(project)                 # nothing edited
    assert path.read_bytes() == TEXT.encode("utf-8")

    dao.upsert(project.id, "Beta", "Edited", "String/English.str")
    dao.upsert(project.id, "Delta", "Fourth", "String/English.str")
    dao.mark_deleted(dao.get_by_id(project.id, "Gamma"))
    session.commit()
    ExportService(session).write_strings(project)
    expected = _lines(TEXT)
    expected[1] = "NumStrings 4"
    expected[7] = '  Value "Edited"  '
    del expected[12:15]                                            # Gamma's block
    expected[11:11] = ["StringInfo", '\tID "Delta"', '\tValue "Fourth"']   # after the last surviving block
    assert _lines(path.read_bytes().decode("utf-8")) == expected

    assert dao.changes(project.id) == []
    assert dao.get_by_id(project.id, "Gamma") is None
    delta = dao.get_by_id(project.id, "Delta")
    assert (delta.original_value, delta.is_new, delta.line_no) == ("Fourth", False, 12)
    assert dao.get_by_id(project.id, "Alpha").duplicate_count == 2   # duplicate survived


def test_output_root_write_leaves_the_mod_alone_and_is_repeatable(mod, tmp_path):
    root, make = mod
    out = tmp_path / "out"
    session, project = make(out)
    dao = StringDAO(session)
    dao.upsert(project.id, "Delta", "Fourth", "String/English.str")
    session.commit()
    ExportService(session).write_strings(project)
    first = (out / "String" / "English.str").read_bytes()
    ExportService(session).write_strings(project)                 # tracking kept: must not append Delta twice
    assert (out / "String" / "English.str").read_bytes() == first
    assert first.decode("utf-8").count('ID "Delta"') == 1
    assert (root / "String" / "English.str").read_bytes() == TEXT.encode("utf-8")
    assert len(dao.changes(project.id)) == 1


def test_missing_table_is_generated(mod):
    root, make = mod
    session, project = make()
    dao = StringDAO(session)
    dao.fill_from_primary(project.id, "String/German.str")
    session.commit()
    ExportService(session).write_strings(project, "String/German.str")
    assert (root / "String" / "German.str").read_text(encoding="utf-8").startswith("TXT\nNumStrings 3\nStringInfo\n")

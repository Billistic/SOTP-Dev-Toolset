"""Localisation files stay separate (issue #13) and over-long values are flagged (issue #11)."""
import os
import shutil
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_strings.db")

from app.db import SessionLocal, dispose_all, init_db, project_session  # noqa: E402
from app.dao import DiagnosticDAO, StringDAO  # noqa: E402
from app.models import Project  # noqa: E402
from app.services.export_service import ExportService  # noqa: E402
from app.services.ingest_service import IngestService  # noqa: E402
from app.services.project_registry import ProjectRegistry  # noqa: E402
from app.services.validation_service import ValidationService  # noqa: E402

LONG = "x" * 300


def _str_file(pairs):
    lines = ["TXT", f"NumStrings {len(pairs)}"]
    for sid, value in pairs:
        lines += ["StringInfo", f'\tID "{sid}"', f'\tValue "{value}"']
    return "\n".join(lines) + "\n"


@pytest.fixture()
def two_languages(gameinfo: Path, tmp_path):
    root = tmp_path / "mod"
    (root / "GameInfo").mkdir(parents=True)
    (root / "String").mkdir()
    shutil.copy(gameinfo / "Player_UNSC_Cole.entity", root / "GameInfo" / "Player_Tech.entity")
    (root / "String" / "English.str").write_text(_str_file([("Hello", "Hello"), ("Long", LONG)]), encoding="utf-8")
    (root / "String" / "French.str").write_text(_str_file([("Hello", "Bonjour")]), encoding="utf-8")
    init_db()
    reg = SessionLocal()
    pid = ProjectRegistry(reg).create(name="lang", mod_root=str(root)).id
    session = project_session(pid)
    project = session.get(Project, pid)
    IngestService(session).ingest(project)
    yield session, project, root
    session.close()
    ProjectRegistry(reg).remove(pid)
    reg.close()
    dispose_all()


def test_files_are_listed_separately(two_languages):
    session, project, _ = two_languages
    files = {f["file"]: f for f in StringDAO(session).file_summary(project.id)}
    assert files["String/English.str"]["count"] == 2 and files["String/French.str"]["count"] == 1
    assert files["String/English.str"]["tooLong"] == 1
    assert StringDAO(session).get_by_id(project.id, "Hello").value == "Hello"   # primary wins without a file
    assert StringDAO(session).value_map(project.id)["Hello"] == "Hello"


def test_editing_a_translation_leaves_english_alone(two_languages):
    session, project, root = two_languages
    dao = StringDAO(session)
    dao.upsert(project.id, "Hello", "Salut", "String/French.str")
    session.commit()
    assert dao.get_by_id(project.id, "Hello", "String/English.str").value == "Hello"
    assert dao.get_by_id(project.id, "Hello", "String/French.str").value == "Salut"
    ExportService(session).write_strings(project, "String/French.str")
    assert '"Salut"' in (root / "String" / "French.str").read_text(encoding="utf-8")
    assert '"Hello"' in (root / "String" / "English.str").read_text(encoding="utf-8")


def test_over_long_value_is_a_warning(two_languages):
    session, project, _ = two_languages
    ValidationService(session).run(project)
    session.commit()
    hits = [d for d in DiagnosticDAO(session).list(project.id, code="STRING_TOO_LONG")]
    assert [d.target for d in hits] == ["Long"]

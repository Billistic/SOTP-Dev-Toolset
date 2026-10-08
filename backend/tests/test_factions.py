"""Factions come from the project's Player entities, not SOTP's naming convention (issue #5)."""
import os
import shutil
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_factions.db")

from app.db import SessionLocal, engine, init_db  # noqa: E402
from app.dao import EntityDAO, ProjectDAO  # noqa: E402
from app.services.faction_service import FactionService  # noqa: E402
from app.services.ingest_service import IngestService  # noqa: E402


@pytest.fixture(scope="module")
def vanilla_style(gameinfo: Path, tmp_path_factory):
    """A tiny mod whose players follow the base game's scheme (Player_Tech / Player_Psi)."""
    root = tmp_path_factory.mktemp("othermod")
    gi = root / "GameInfo"
    gi.mkdir()
    shutil.copy(gameinfo / "Player_UNSC_Cole.entity", gi / "Player_Tech.entity")
    shutil.copy(gameinfo / "Player_Cov_Regret.entity", gi / "Player_Psi.entity")
    cole_only = "Capital_UNSC_Artemis_Cole"   # listed by the Cole player only, so by Player_Tech here
    shutil.copy(gameinfo / f"{cole_only}.entity", gi / f"{cole_only}.entity")
    for f in Path(".").glob("test_factions.db*"):
        f.unlink()
    init_db()
    session = SessionLocal()
    project = ProjectDAO(session).create(name="other", mod_root=str(root))
    session.commit()
    IngestService(session).ingest(project)
    yield session, project, cole_only
    session.close()
    engine.dispose()
    for f in Path(".").glob("test_factions.db*"):
        try:
            f.unlink()
        except PermissionError:
            pass


def test_factions_listed_from_players(vanilla_style):
    session, project, _ = vanilla_style
    names = {f["faction"] for f in FactionService(session).factions(project.id)}
    assert names == {"Tech", "Psi"}


def test_membership_beats_name_suffix(vanilla_style):
    session, project, cole_only = vanilla_style
    e = EntityDAO(session).by_name(project.id, cole_only)
    assert e.faction == "Tech"   # the _Cole suffix would have said "Cole"

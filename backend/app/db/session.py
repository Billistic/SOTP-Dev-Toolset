"""
SQLAlchemy engine / session wiring.

``DATABASE_URL`` (SQLite) is the *registry*: it holds the ``projects`` table. Every project keeps its data in
its own file next to it (``<registry>.projects/project-<id>.db``), which also carries a mirror of its own
``projects`` row so foreign keys and ``project.id`` filters keep working unchanged. Request sessions
(``get_db``) are bound to the active project's file. WAL mode keeps the UI responsive while an ingest writes.
"""
from __future__ import annotations

import shutil
import sqlite3
import threading
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from ..config import settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str) -> Engine:
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    eng = create_engine(url, connect_args=connect_args, future=True)
    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _sqlite_pragmas(conn, _record):  # pragma: no cover - driver hook
            cur = conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()
    return eng


engine = _make_engine(settings.database_url)   # the registry
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)

_project_engines: dict[int, Engine] = {}
_lock = threading.Lock()


def _registry_path() -> Path:
    return Path(engine.url.database or "sotp_devenv.db").resolve()


def project_db_path(project_id: int) -> Path:
    reg = _registry_path()
    return reg.with_name(f"{reg.stem}.projects") / f"project-{project_id}.db"


def project_engine(project_id: int) -> Engine:
    """Engine for one project's data file, created (schema + additive migrations) on first use."""
    with _lock:
        eng = _project_engines.get(project_id)
        if eng is None:
            path = project_db_path(project_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            eng = _make_engine(f"sqlite:///{path.as_posix()}")
            _create_schema(eng)
            _project_engines[project_id] = eng
        return eng


def project_session(project_id: int) -> Session:
    return Session(bind=project_engine(project_id), autoflush=False, expire_on_commit=False)


def drop_project_db(project_id: int) -> None:
    """Close and delete a project's data file (and its WAL / SHM side files)."""
    with _lock:
        eng = _project_engines.pop(project_id, None)
    if eng is not None:
        eng.dispose()
    path = project_db_path(project_id)
    for f in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
        try:
            f.unlink()
        except FileNotFoundError:
            pass


def dispose_all() -> None:
    """Release every SQLite file (tests on Windows need this before deleting them)."""
    with _lock:
        for eng in _project_engines.values():
            eng.dispose()
        _project_engines.clear()
    engine.dispose()


def init_db() -> None:
    _create_schema(engine)
    _split_legacy_registry()


def _create_schema(eng: Engine) -> None:
    from .. import models  # noqa: F401  (registers tables on Base)
    Base.metadata.create_all(bind=eng)
    _add_missing_columns(eng)


def _add_missing_columns(eng: Engine) -> None:
    """Additive migration: columns added to a model after the DB was created get ALTER TABLE'd in."""
    insp = inspect(eng)
    with eng.begin() as conn:
        for table in Base.metadata.sorted_tables:
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                ddl = f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(eng.dialect)}'
                if default is not None:
                    ddl += f" DEFAULT {int(default) if isinstance(default, bool) else repr(default)}"
                conn.execute(text(ddl))


def _data_tables() -> list[str]:
    return [t.name for t in reversed(Base.metadata.sorted_tables) if t.name != "projects"]


def _split_legacy_registry() -> None:
    """One-off migration from the single shared DB: copy each project's rows into its own file, then empty
    the registry's data tables. Lossless: each copy is a full SQLite backup with other projects' rows removed."""
    if not str(engine.url).startswith("sqlite"):
        return
    with engine.connect() as conn:
        pids = [r[0] for r in conn.execute(text("SELECT DISTINCT project_id FROM entities"))]
        known = {r[0] for r in conn.execute(text("SELECT id FROM projects"))}
    pids = [p for p in pids if p in known]
    if not pids:
        return
    reg = _registry_path()
    for pid in pids:
        target = project_db_path(pid)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".tmp")
        tmp.unlink(missing_ok=True)   # left over from an interrupted run
        src, dst = sqlite3.connect(reg), sqlite3.connect(tmp)
        with dst:
            src.backup(dst)
        src.close()
        dst.execute("PRAGMA foreign_keys=OFF")
        for t in _data_tables():   # children first: per-entity tables hang off entity_id, the rest carry project_id
            cols = {r[1] for r in dst.execute(f"PRAGMA table_info({t})")}
            if "project_id" in cols:
                dst.execute(f"DELETE FROM {t} WHERE project_id != ?", (pid,))
            elif "entity_id" in cols:
                dst.execute(f"DELETE FROM {t} WHERE entity_id NOT IN (SELECT id FROM entities WHERE project_id = ?)", (pid,))
        dst.execute("DELETE FROM projects WHERE id != ?", (pid,))
        dst.execute("UPDATE projects SET is_active = 1")
        dst.commit()
        dst.execute("VACUUM")
        dst.close()
        shutil.move(tmp, target)
    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys=OFF"))
        for t in _data_tables():
            conn.execute(text(f"DELETE FROM {t}"))
    with engine.connect() as conn:
        conn.execution_options(isolation_level="AUTOCOMMIT").execute(text("VACUUM"))


def active_project_id() -> int | None:
    from ..models import Project
    with SessionLocal() as reg:
        return reg.scalar(select(Project.id).where(Project.is_active.is_(True)))


def get_db():
    """FastAPI dependency: a request-scoped session on the active project's data file
    (the registry when no project is active, so ``get_project`` answers 404)."""
    pid = active_project_id()
    db = project_session(pid) if pid is not None else SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_registry():
    """FastAPI dependency: a session on the project registry (project CRUD)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

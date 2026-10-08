"""
FastAPI application factory.

Run with:  uvicorn app.main:app --reload
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .api import catalog, entities, insights, projects, updates
from .config import settings
from .db import SessionLocal, init_db
from .services.project_registry import ProjectRegistry
from .version import __version__

log = logging.getLogger("sotp")


def _seed_project_from_env() -> None:
    """First start convenience: create a project from SOTP_MOD_ROOT if none exists."""
    if not settings.default_mod_root or not Path(settings.default_mod_root).is_dir():
        return
    with SessionLocal() as db:
        registry = ProjectRegistry(db)
        if not registry.list():
            registry.create(name=Path(settings.default_mod_root).name, mod_root=settings.default_mod_root,
                            vanilla_root=settings.default_vanilla_root)
            log.info("seeded project from SOTP_MOD_ROOT=%s", settings.default_mod_root)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    _seed_project_from_env()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="SOTP Dev Env v2", version=__version__, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins) or ["*"],
                       allow_methods=["*"], allow_headers=["*"])
    for r in (projects.router, entities.router, catalog.router, insights.router, updates.router):
        app.include_router(r, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": app.version}

    ui = Path(settings.ui_dir) if settings.ui_dir else None
    if ui and (ui / "index.html").is_file():   # desktop build: same origin for API and UI, mounted last so /api wins
        app.mount("/", StaticFiles(directory=str(ui), html=True), name="ui")

    return app


app = create_app()

"""Self-update endpoints used by the desktop build (check / download / install)."""
from __future__ import annotations

from fastapi import APIRouter

from ..services.update_service import get_update_service

router = APIRouter(prefix="/updates", tags=["updates"])


@router.get("/check")
def check(force: bool = False):
    return get_update_service().check(force=force)


@router.post("/download")
def download():
    return get_update_service().start_download()


@router.get("/status")
def status():
    return get_update_service().status()


@router.post("/install")
def install():
    return get_update_service().install()

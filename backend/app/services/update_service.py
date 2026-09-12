"""
Discord-style updates for the desktop build: ask GitHub Releases for the newest
version, download the installer in the background with progress, verify its
hash and Authenticode signature, then run it silently and let it relaunch us.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from ..version import __version__

API = os.getenv("SOTP_UPDATE_API", "https://api.github.com/repos/{repo}/releases/latest")   # overridable for tests
ASSET_RE = re.compile(r"^SOTP-Dev-Env-Setup-.*\.exe$", re.I)
CHECK_TTL = 30 * 60


def parse_version(text: str) -> tuple[int, ...]:
    nums = re.findall(r"\d+", text or "")
    return tuple(int(n) for n in nums[:3]) or (0,)


@dataclass
class UpdateInfo:
    current: str = __version__
    latest: str | None = None
    available: bool = False
    notes: str = ""
    url: str | None = None
    size: int | None = None
    sha256: str | None = None
    publishedAt: str | None = None
    releaseUrl: str | None = None
    checkedAt: float | None = None
    error: str | None = None


@dataclass
class DownloadState:
    state: str = "idle"          # idle | downloading | verifying | ready | failed | installing
    received: int = 0
    total: int | None = None
    path: str | None = None
    error: str | None = None
    signature: str | None = None  # Valid | NotSigned | NotTrusted | ...
    extra: dict[str, Any] = field(default_factory=dict)


class UpdateService:
    """One instance per process (module-level singleton below); thread-safe enough for a single desktop user."""

    def __init__(self, data_dir: Path, repo: str, *, allow_unsigned: bool = False):
        self.data_dir = data_dir
        self.repo = repo
        self.allow_unsigned = allow_unsigned
        self.frozen = bool(getattr(sys, "frozen", False))
        self.info = UpdateInfo()
        self.download = DownloadState()
        self._lock = threading.Lock()

    # ── check ───────────────────────────────────────────────────────────
    def check(self, force: bool = False) -> dict[str, Any]:
        if not force and self.info.checkedAt and time.time() - self.info.checkedAt < CHECK_TTL:
            return self.payload()
        info = UpdateInfo(checkedAt=time.time())
        try:
            rel = self._get_json(API.format(repo=self.repo))
            info.latest = str(rel.get("tag_name") or rel.get("name") or "").lstrip("v")
            info.notes = rel.get("body") or ""
            info.publishedAt = rel.get("published_at")
            info.releaseUrl = rel.get("html_url")
            asset = next((a for a in rel.get("assets", []) if ASSET_RE.match(a.get("name", ""))), None)
            if asset:
                info.url, info.size = asset.get("browser_download_url"), asset.get("size")
                digest = asset.get("digest") or ""            # GitHub publishes "sha256:<hex>" per asset
                info.sha256 = digest.split(":", 1)[1] if digest.startswith("sha256:") else None
            manifest = next((a for a in rel.get("assets", []) if a.get("name") == "latest.json"), None)
            if manifest:  # our own manifest wins when present (notes / hash written by the build)
                try:
                    m = self._get_json(manifest["browser_download_url"])
                    info.sha256 = m.get("sha256") or info.sha256
                    info.notes = m.get("notes") or info.notes
                except Exception:
                    pass
            info.available = bool(info.url) and parse_version(info.latest or "") > parse_version(info.current)
        except urllib.error.HTTPError as exc:
            if exc.code != 404:   # 404 = the repo has no releases yet, which is not an error worth showing
                info.error = f"HTTP {exc.code} from GitHub"
        except Exception as exc:
            info.error = f"{type(exc).__name__}: {exc}"
        self.info = info
        return self.payload()

    def payload(self) -> dict[str, Any]:
        return {**asdict(self.info), "supported": self.frozen, "repo": self.repo}

    # ── download ────────────────────────────────────────────────────────
    def start_download(self) -> dict[str, Any]:
        with self._lock:
            if self.download.state in ("downloading", "verifying", "installing"):
                return asdict(self.download)
            if not self.info.url:
                self.check(force=True)
            if not self.info.available or not self.info.url:
                self.download = DownloadState(state="failed", error="no update available")
                return asdict(self.download)
            self.download = DownloadState(state="downloading", total=self.info.size)
            threading.Thread(target=self._download, name="update-download", daemon=True).start()
            return asdict(self.download)

    def _download(self) -> None:
        folder = self.data_dir / "updates"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"SOTP-Dev-Env-Setup-{self.info.latest}.exe"
        part = target.with_suffix(".exe.part")
        try:
            req = urllib.request.Request(self.info.url, headers={"User-Agent": "SOTP-Dev-Env"})
            with urllib.request.urlopen(req, timeout=30) as r, open(part, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0) or self.download.total
                self.download.total = total
                h = hashlib.sha256()
                while chunk := r.read(1 << 16):
                    f.write(chunk)
                    h.update(chunk)
                    self.download.received += len(chunk)
            self.download.state = "verifying"
            digest = h.hexdigest()
            if self.info.sha256 and digest.lower() != self.info.sha256.lower():
                raise ValueError("sha256 mismatch - download discarded")
            part.replace(target)
            self.download.signature = authenticode_status(target)
            if self.download.signature != "Valid" and not self.allow_unsigned:
                raise ValueError(f"installer signature is {self.download.signature}; refusing to install")
            self.download.path = str(target)
            self.download.state = "ready"
        except Exception as exc:
            self.download.state, self.download.error = "failed", f"{type(exc).__name__}: {exc}"
            for p in (part, target):
                try:
                    p.unlink()
                except OSError:
                    pass

    def status(self) -> dict[str, Any]:
        return asdict(self.download)

    # ── install ─────────────────────────────────────────────────────────
    def install(self) -> dict[str, Any]:
        if self.download.state != "ready" or not self.download.path:
            return {"ok": False, "error": "no verified installer downloaded"}
        if not self.frozen:
            return {"ok": False, "error": "install is only available from the desktop build"}
        args = [self.download.path, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-", "/CLOSEAPPLICATIONS", "/UPDATE=1"]
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen(args, creationflags=flags, close_fds=True)
        self.download.state = "installing"
        threading.Timer(0.8, lambda: os._exit(0)).start()   # the installer replaces our files and relaunches us
        return {"ok": True}

    # ── helpers ─────────────────────────────────────────────────────────
    @staticmethod
    def _get_json(url: str) -> dict[str, Any]:
        headers = {"User-Agent": "SOTP-Dev-Env", "Accept": "application/vnd.github+json"}
        if token := os.getenv("GITHUB_TOKEN"):
            headers["Authorization"] = f"Bearer {token}"
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as r:
            return json.load(r)


def authenticode_status(path: Path) -> str:
    """Windows Authenticode verdict via PowerShell: Valid, NotSigned, UnknownError (untrusted), ..."""
    if os.name != "nt":
        return "Unsupported"
    cmd = ["powershell", "-NoProfile", "-NonInteractive", "-Command",
           f"(Get-AuthenticodeSignature -FilePath '{path}').Status.ToString()"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return (out.stdout or "").strip() or f"Unknown({out.returncode})"
    except Exception as exc:
        return f"Error({type(exc).__name__})"


_service: UpdateService | None = None


def get_update_service() -> UpdateService:
    global _service
    if _service is None:
        from ..config import settings
        _service = UpdateService(settings.data_dir, settings.update_repo, allow_unsigned=settings.allow_unsigned_updates)
    return _service

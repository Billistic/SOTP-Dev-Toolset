"""
One-shot desktop build:  python desktop/build.py [--skip-frontend] [--installer] [--no-sign]

  1. builds the React UI (npm run build) and stages it as desktop/build/ui
  2. freezes backend + launcher with PyInstaller into desktop/dist/SOTP Dev Env/
  3. Authenticode-signs the exe (desktop/sign.ps1; skipped when no certificate is configured)
  4. with --installer (or when Inno Setup is found) compiles installer.iss into
     desktop/dist/SOTP-Dev-Env-Setup-<version>.exe - signed, including its uninstaller -
     and writes desktop/dist/latest.json (version, sha256, size) for the in-app updater
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
STAGE = HERE / "build"
DIST = HERE / "dist"
PY = BACKEND / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = Path(sys.executable)
ISCC_CANDIDATES = [Path(p) for p in (
    r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe", r"C:\Program Files\Inno Setup 6\ISCC.exe")]
SIGN_PS1 = HERE / "sign.ps1"

sys.path.insert(0, str(BACKEND))
from app.version import __version__ as VERSION  # noqa: E402


def run(cmd: list[str], cwd: Path) -> None:
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, cwd=str(cwd), check=True, shell=(os.name == "nt" and cmd[0] in ("npm", "npx")))


def signing_configured() -> bool:
    return bool(os.environ.get("SOTP_SIGN_PFX") or os.environ.get("SOTP_SIGN_THUMBPRINT") or (HERE / "certs" / "dev-codesign.pfx").exists())


def sign(*files: Path) -> None:
    run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SIGN_PS1), *map(str, files)], HERE)


def build_frontend() -> None:
    run(["npm", "run", "build"], FRONTEND)
    if STAGE.exists():
        shutil.rmtree(STAGE)
    shutil.copytree(FRONTEND / "dist", STAGE / "ui")


def build_exe() -> Path:
    if not (HERE / "icon.ico").exists():
        run([str(PY), str(HERE / "make_icon.py")], HERE)
    args = [
        str(PY), "-m", "PyInstaller", "--noconfirm", "--clean", "--windowed",
        "--name", "SOTP Dev Env", "--icon", str(HERE / "icon.ico"),
        "--distpath", str(DIST), "--workpath", str(STAGE / "pyi"), "--specpath", str(STAGE),
        "--paths", str(BACKEND),
        "--add-data", f"{STAGE / 'ui'}{os.pathsep}ui",
        "--add-data", f"{HERE / 'icon.ico'}{os.pathsep}.",   # window / taskbar icon at runtime
        "--collect-submodules", "app",          # the backend package (routers are imported dynamically by name)
        "--add-data", f"{BACKEND / 'app' / 'sins' / 'defs'}{os.pathsep}app/sins/defs",   # the entity grammar tables
        "--collect-submodules", "uvicorn",      # loop / protocol implementations are chosen at runtime
        "--collect-all", "webview",             # WebView2 loader DLLs
        "--hidden-import", "sqlalchemy.dialects.sqlite",
        str(HERE / "launcher.py"),
    ]
    run(args, HERE)
    return DIST / "SOTP Dev Env" / "SOTP Dev Env.exe"


def build_installer(do_sign: bool) -> Path | None:
    iscc = next((p for p in ISCC_CANDIDATES if p.exists()), None)
    if iscc is None:
        print("Inno Setup not found - install it from https://jrsoftware.org/isinfo.php and rerun with --installer,")
        print(f"or ship the folder {DIST / 'SOTP Dev Env'} as a zip.")
        return None
    args = [str(iscc), f"/DAppVersion={VERSION}", f"/DSourceDir={DIST / 'SOTP Dev Env'}", f"/O{DIST}"]
    if do_sign:  # Inno calls this for Setup.exe and the uninstaller; $f is the file to sign
        args += ["/DSign", f"/Ssotp=powershell -NoProfile -ExecutionPolicy Bypass -File $q{SIGN_PS1}$q $f"]   # $q = quote in Inno
    args.append(str(HERE / "installer.iss"))
    run(args, HERE)
    setup = DIST / f"SOTP-Dev-Env-Setup-{VERSION}.exe"
    write_manifest(setup)
    return setup


def write_manifest(setup: Path) -> None:
    """latest.json travels with the release so the updater can verify what it downloads."""
    digest = hashlib.sha256(setup.read_bytes()).hexdigest()
    notes_file = ROOT / "CHANGELOG.md"
    notes = ""
    if notes_file.exists():   # first section of the changelog = this version's notes
        body = notes_file.read_text(encoding="utf-8").split("\n## ")
        notes = ("## " + body[1]) if len(body) > 1 else body[0]
    manifest = {"version": VERSION, "file": setup.name, "sha256": digest, "size": setup.stat().st_size,
                "notes": notes.strip(), "published": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (DIST / "latest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (DIST / "release-notes.md").write_text(notes.strip() or f"SOTP Dev Env {VERSION}", encoding="utf-8")
    print(f"installer: {setup}  sha256={digest[:12]}...  ({setup.stat().st_size / 1e6:.1f} MB)")


def main() -> int:
    do_sign = "--no-sign" not in sys.argv and signing_configured()
    if "--skip-frontend" not in sys.argv:
        build_frontend()
    elif not (STAGE / "ui").exists():
        print("no staged UI; run without --skip-frontend first")
        return 1
    exe = build_exe()
    if do_sign:
        sign(exe)
    else:
        print("signing: skipped (no SOTP_SIGN_PFX / SOTP_SIGN_THUMBPRINT / dev cert)")
    print(f"\napp folder: {DIST / 'SOTP Dev Env'}  (v{VERSION})")
    if "--installer" in sys.argv or any(p.exists() for p in ISCC_CANDIDATES):
        build_installer(do_sign)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""
Desktop entry point: starts the FastAPI backend on a free local port and opens
the built UI in a native WebView2 window.  Data (database, .env, logs, window
storage) lives in %LOCALAPPDATA%\\SOTP Dev Env so the install folder stays clean.
"""
from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

APP_NAME = "SOTP Dev Env"
FROZEN = getattr(sys, "frozen", False)
BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))   # PyInstaller unpack dir or this folder


def data_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    d = base / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def configure_environment(d: Path) -> None:
    os.environ.setdefault("SOTP_DATA_DIR", str(d))
    os.environ.setdefault("DATABASE_URL", f"sqlite:///{(d / 'sotp_devenv.db').as_posix()}")
    ui = BUNDLE / "ui" if FROZEN else Path(__file__).resolve().parents[1] / "frontend" / "dist"
    os.environ.setdefault("SOTP_UI_DIR", str(ui))
    if not FROZEN:   # dev run: import the backend package from the checkout
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    logging.basicConfig(filename=d / "launcher.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def start_backend(port: int):
    import uvicorn
    from app.main import app   # noqa: WPS433 - after sys.path / env are ready

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info", log_config=None)
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, name="uvicorn", daemon=True).start()
    return server


def wait_for(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.15)
    return False


def open_window(url: str, d: Path) -> None:
    import webview
    window = webview.create_window(APP_NAME, url, width=1480, height=920, min_size=(1100, 680),
                                   background_color="#0f0f0f", text_select=True)
    # storage_path keeps localStorage (theme, tabs, graph settings) between launches
    webview.start(gui="edgechromium", private_mode=False, storage_path=str(d / "webview"), debug="--devtools" in sys.argv)
    del window


def already_running() -> bool:
    """Named mutex so a second click on the shortcut does not start a second backend/window."""
    try:
        import ctypes
        ctypes.windll.kernel32.CreateMutexW(None, False, r"Local\SOTPDevEnv")
        return ctypes.windll.kernel32.GetLastError() == 183   # ERROR_ALREADY_EXISTS
    except Exception:
        return False


def main() -> int:
    if already_running():
        _fail("SOTP Dev Env is already running.")
        return 0
    d = data_dir()
    configure_environment(d)
    log = logging.getLogger("launcher")
    port = int(os.environ.get("PORT") or free_port())
    url = f"http://127.0.0.1:{port}"
    log.info("starting backend on %s (data dir %s)", url, d)
    server = start_backend(port)
    if not wait_for(f"{url}/api/health"):
        log.error("backend did not come up")
        _fail("The SOTP Dev Env backend did not start.\nSee launcher.log in " + str(d))
        return 1
    try:
        open_window(url, d)
    except Exception as exc:   # WebView2 missing or broken: fall back to the default browser
        log.exception("webview failed, falling back to browser")
        import webbrowser
        webbrowser.open(url)
        _fail(f"Could not open the app window ({exc}).\nThe tool is running in your browser at {url}; close this dialog to stop it.")
    server.should_exit = True
    time.sleep(0.5)
    return 0


def _fail(message: str) -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x10)
    except Exception:
        print(message, file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())

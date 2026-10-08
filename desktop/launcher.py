"""
Desktop entry point: opens a small splash window at once (the emblem tracing in while
the FastAPI backend boots on a free local port), then turns that same window into the
app window and loads the built UI.  Data (database, .env, logs, window storage) lives
in %LOCALAPPDATA%\\SOTP Dev Env so the install folder stays clean.
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

from native_window import NativeFrame, enable_per_monitor_dpi, work_area_logical

APP_NAME = "SOTP Dev Env"
FROZEN = getattr(sys, "frozen", False)
BUNDLE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))   # PyInstaller unpack dir or this folder
HERE = BUNDLE if FROZEN else Path(__file__).resolve().parent                # splash.html / icon.ico live here
SPLASH_SIZE = (394, 337)   # pywebview reserves a frame allowance even when frameless; this yields a ~380x300 page
MIN_SIZE = (1000, 640)


def data_dir() -> Path:
    """%LOCALAPPDATA%\SOTP Dev Env, or SOTP_DATA_DIR when set (a second, isolated instance for testing / portable use)."""
    override = os.environ.get("SOTP_DATA_DIR")
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    d = Path(override) if override else base / APP_NAME
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
    logging.basicConfig(filename=d / "launcher.log", level=logging.DEBUG if "--devtools" in sys.argv else logging.INFO,
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


class WindowApi:
    """Exposed to the page as window.pywebview.api - the custom title bar's minimize / maximize / close."""

    def __init__(self) -> None:
        self._window = None       # underscore: pywebview serialises public attributes into the JS bridge
        self._frame = None        # native_window.NativeFrame once the app page is up
        self._maximized = False

    def minimize(self) -> None:
        self._window.minimize()

    def toggle_maximize(self) -> bool:
        if self._maximized:
            self._window.restore()
        else:
            self._window.maximize()
        self._maximized = not self._maximized
        return self._maximized

    def is_maximized(self) -> bool:
        return self._maximized

    def close(self) -> None:
        self._window.destroy()

    # the title bar and the page's edge zones hand the pressed button to Windows' own move / resize loops,
    # so Snap, Win+arrow, FancyZones and the minimum size all behave as in any native window (see native_window.py)
    def start_drag(self) -> bool:
        return bool(self._frame and self._frame.start("caption"))

    def start_resize(self, edge: str) -> bool:
        return bool(self._frame and not self._maximized and self._frame.start(edge))


def splash_html() -> str:
    """The splash page with the version filled in; a plain placeholder if the file is missing."""
    try:
        from app.version import __version__
    except Exception:
        __version__ = ""
    path = HERE / "splash.html"
    if path.is_file():
        return path.read_text(encoding="utf-8").replace("__VERSION__", f"v{__version__}" if __version__ else "")
    return f"<html><body style='margin:0;background:#0f0f0f;color:#f2f2f2;font-family:Segoe UI;display:grid;place-items:center;height:100vh'>{APP_NAME}</body></html>"


def app_geometry() -> tuple[int, int, int | None, int | None]:
    """App window: ~90% of the primary monitor's work area (capped), centred. Logical pixels throughout, which is
    what pywebview expects (screens[] mixes in physical ones, so at 125 % the window used to open half off-screen)."""
    try:
        left, top, sw, sh, _ = work_area_logical()
        width, height = max(MIN_SIZE[0], min(1480, int(sw * 0.9))), max(MIN_SIZE[1], min(920, int(sh * 0.9)))
        width, height = min(width, sw), min(height, sh)
        return width, height, left + max(0, (sw - width) // 2), top + max(0, (sh - height) // 2)
    except Exception:
        return 1280, 820, None, None


def splash_geometry() -> tuple[int | None, int | None]:
    try:
        left, top, sw, sh, _ = work_area_logical()
        return left + (sw - SPLASH_SIZE[0]) // 2, top + (sh - SPLASH_SIZE[1]) // 2 - 40
    except Exception:
        return None, None


def open_window(d: Path, port: int) -> int:
    """Splash first; ``boot`` (below) brings the backend up behind it and then swaps the page for the UI."""
    import webview
    webview.settings["ALLOW_DOWNLOADS"] = True   # pywebview cancels downloads by default; CSV exports need the Save dialog
    api = WindowApi()
    sx, sy = splash_geometry()
    # frameless: the splash draws its own tile, later the React TitleBar draws the caption and window buttons
    window = webview.create_window(APP_NAME, html=splash_html(), width=SPLASH_SIZE[0], height=SPLASH_SIZE[1], x=sx, y=sy,
                                   frameless=True, easy_drag=False, background_color="#0f0f0f", text_select=True, js_api=api)
    api._window = window
    window._sotp_api = api   # boot() hands the native frame to the api once the app page is up
    def on_state(maximized: bool) -> None:   # Win+Up, drag-off-the-top, snap: keep api and the page's buttons honest
        api._maximized = maximized
        try:
            window.evaluate_js(f"window.dispatchEvent(new CustomEvent('sotp-window-state', {{detail: {str(maximized).lower()}}}))")
        except Exception:
            pass
    for name, value in (("maximized", True), ("restored", False)):
        try:
            getattr(window.events, name).__iadd__(lambda v=value: on_state(v))
        except AttributeError:
            pass
    result: dict = {"code": 0, "server": None}
    # storage_path keeps localStorage (theme, tabs, graph settings) between launches; icon = taskbar / alt-tab
    icon = HERE / "icon.ico"
    webview.start(boot, (window, d, port, result), gui="edgechromium", private_mode=False, storage_path=str(d / "webview"),
                  debug="--devtools" in sys.argv, icon=str(icon) if icon.exists() else None)
    if result["server"] is not None:   # window closed: stop the backend thread
        result["server"].should_exit = True
    return result["code"]


def boot(window, d: Path, port: int, result: dict) -> None:
    """Runs on a worker thread once the splash is showing: backend up, then the window becomes the app."""
    log = logging.getLogger("launcher")
    url = f"http://127.0.0.1:{port}"

    def status(text: str, progress: float | None = None) -> None:
        try:
            window.evaluate_js(f"setStatus({text!r}, {'null' if progress is None else progress})")
        except Exception:   # the page may not be ready for the first call; the next one lands
            pass

    status("Starting backend")
    log.info("starting backend on %s (data dir %s)", url, d)
    try:
        server = start_backend(port)
    except Exception:
        log.exception("backend failed to start")
        status("The backend failed to start")
        _fail("The SOTP Dev Env backend failed to start.\nSee launcher.log in " + str(d))
        result["code"] = 1
        window.destroy()
        return
    if not wait_for(f"{url}/api/health"):
        log.error("backend did not come up")
        status("The backend did not answer")
        _fail("The SOTP Dev Env backend did not start.\nSee launcher.log in " + str(d))
        result["code"] = 1
        window.destroy()
        return
    status("Backend ready", 0.5)
    time.sleep(0.25)
    status("Loading interface", 0.8)
    result["server"] = server   # the exit path stops it once the window is gone
    # swap: fade the splash, grow the window to app size, load the UI (same window, so no taskbar flicker)
    try:
        window.evaluate_js("leave()")
    except Exception:
        pass
    time.sleep(0.3)
    width, height, x, y = app_geometry()
    window.load_url(url)
    try:
        if x is not None:
            window.move(x, y)
        window.resize(width, height)
        _set_min_size(window, *MIN_SIZE)
    except Exception:
        log.exception("could not size the app window")
    try:   # Snap / hotkeys / native resize / DPI changes (QA #7); the splash before this stays a plain tile
        frame = NativeFrame(window.native)
        frame.install()
        window._sotp_api._frame = frame
    except Exception:
        log.exception("could not install the native window frame; falling back to plain frameless")


def _set_min_size(window, w: int, h: int) -> None:
    """The splash is smaller than the app's minimum, so the minimum is applied only now (physical pixels, UI thread)."""
    form = getattr(window, "native", None)
    if form is None:
        return
    from System import Action
    from System.Drawing import Size
    scale = getattr(form, "_scale", 1.0) or 1.0

    def apply():
        form.MinimumSize = Size(int(w * scale), int(h * scale))
    form.Invoke(Action(apply))


def already_running() -> bool:
    """Named mutex so a second click on the shortcut does not start a second backend/window."""
    try:
        import ctypes
        ctypes.windll.kernel32.CreateMutexW(None, False, r"Local\SOTPDevEnv")
        return ctypes.windll.kernel32.GetLastError() == 183   # ERROR_ALREADY_EXISTS
    except Exception:
        return False


def main() -> int:
    if already_running() and not os.environ.get("SOTP_ALLOW_MULTIPLE"):
        _fail("SOTP Dev Env is already running.")
        return 0
    enable_per_monitor_dpi()   # before any window exists (pywebview would otherwise make it system-DPI aware)
    d = data_dir()
    configure_environment(d)
    log = logging.getLogger("launcher")
    port = int(os.environ.get("PORT") or free_port())
    url = f"http://127.0.0.1:{port}"
    code = 0
    try:
        code = open_window(d, port)
    except Exception as exc:   # WebView2 missing or broken: boot the backend here and fall back to the default browser
        log.exception("webview failed, falling back to browser")
        server = start_backend(port)
        if wait_for(f"{url}/api/health"):
            import webbrowser
            webbrowser.open(url)
            _fail(f"Could not open the app window ({exc}).\nThe tool is running in your browser at {url}; close this dialog to stop it.")
        server.should_exit = True
    time.sleep(0.5)
    return code


def _fail(message: str) -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, APP_NAME, 0x10)
    except Exception:
        print(message, file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())

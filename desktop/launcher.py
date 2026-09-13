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

    # frameless forms have no border to grab, so the page's edge zones drive the resize: begin() snapshots
    # the window rect, drag() applies pointer deltas (physical px) with SetWindowPos, honouring the min size
    MIN_W, MIN_H = 1000, 640   # logical px, matches create_window(min_size=...)

    def begin_resize(self, edge: str) -> bool:
        form = getattr(self._window, "native", None)
        if form is None or self._maximized:
            return False
        import ctypes
        from ctypes import wintypes
        rect = wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(int(form.Handle.ToInt64()), ctypes.byref(rect))
        self._resize = (edge, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
        logging.getLogger("launcher").info("begin_resize %s %s", edge, self._resize[1:])
        return True

    def drag_resize(self, dx: float, dy: float, scale: float = 1.0) -> None:
        if not getattr(self, "_resize", None):
            return
        import ctypes
        edge, x0, y0, w0, h0 = self._resize
        min_w, min_h = int(self.MIN_W * scale), int(self.MIN_H * scale)
        x, y, w, h = x0, y0, w0, h0
        dx, dy = int(dx), int(dy)
        if "right" in edge:
            w = max(min_w, w0 + dx)
        if "left" in edge:
            w = max(min_w, w0 - dx)
            x = x0 + (w0 - w)
        if "bottom" in edge:
            h = max(min_h, h0 + dy)
        if "top" in edge:
            h = max(min_h, h0 - dy)
            y = y0 + (h0 - h)
        form = self._window.native
        ok = ctypes.windll.user32.SetWindowPos(int(form.Handle.ToInt64()), None, x, y, w, h, 0x0004 | 0x0010)   # NOZORDER | NOACTIVATE
        logging.getLogger("launcher").debug("drag_resize %s -> %s ok=%s", (dx, dy), (x, y, w, h), ok)

    def end_resize(self) -> None:
        self._resize = None


def open_window(url: str, d: Path) -> None:
    import webview
    webview.settings["ALLOW_DOWNLOADS"] = True   # pywebview cancels downloads by default; CSV exports need the Save dialog
    api = WindowApi()
    # size to the primary screen (90%, capped) and centre it; frameless windows get no help from Windows here
    try:
        scr = webview.screens[0]
        width, height = min(1480, int(scr.width * 0.9)), min(920, int(scr.height * 0.88))
        x, y = max(0, (scr.width - width) // 2), max(0, (scr.height - height) // 2 - 20)
    except Exception:
        width, height, x, y = 1280, 820, None, None
    # frameless: the React TitleBar component draws the caption and window buttons (Discord / Claude Desktop style)
    window = webview.create_window(APP_NAME, url, width=width, height=height, x=x, y=y, min_size=(1000, 640), frameless=True,
                                   easy_drag=False, background_color="#0f0f0f", text_select=True, js_api=api)
    api._window = window
    for name, value in (("maximized", True), ("restored", False)):   # keep the state honest for Win+Up / snap
        try:
            getattr(window.events, name).__iadd__(lambda v=value: setattr(api, "_maximized", v))
        except AttributeError:
            pass
    # storage_path keeps localStorage (theme, tabs, graph settings) between launches; icon = taskbar / alt-tab
    icon = BUNDLE / "icon.ico" if FROZEN else Path(__file__).resolve().parent / "icon.ico"
    webview.start(gui="edgechromium", private_mode=False, storage_path=str(d / "webview"), debug="--devtools" in sys.argv,
                  icon=str(icon) if icon.exists() else None)


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

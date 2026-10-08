"""
Win32 glue that makes the frameless pywebview window behave like a native one (QA #7).

pywebview's ``frameless=True`` gives a WinForms form with no window styles, and its drag region moves the window
with SetWindowPos.  Windows only offers Snap (drag to an edge, Snap layouts / Win+Z, Win+arrow keys) to windows
that have a resizable frame and are moved by its own move loop, so here we:

* put WS_THICKFRAME / WS_CAPTION / WS_MAXIMIZEBOX ... back, and hide the frame they imply by answering
  WM_NCCALCSIZE with "the client area is the whole window" (the React TitleBar still draws the caption);
* start drags and edge resizes with WM_NCLBUTTONDOWN + HTCAPTION / HTLEFT ..., i.e. Windows' own loops, which
  is what Snap, Aero-shake and FancyZones hook into (the same technique Tauri / wry use for WebView2);
* clamp maximise to the monitor's work area (a borderless maximise would otherwise cover the taskbar);
* run per-monitor DPI aware (v2) and follow WM_DPICHANGED, so moving between monitors with different
  display scaling re-renders sharply instead of being bitmap-stretched.
"""
from __future__ import annotations

import ctypes
import logging
from ctypes import wintypes

log = logging.getLogger("launcher")

user32 = ctypes.WinDLL("user32")   # private handle: argtypes set here must not leak into pywebview's windll calls
LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)

user32.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.CallWindowProcW.restype = LRESULT
user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
user32.SetWindowLongPtrW.restype = ctypes.c_void_p
user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowLongPtrW.restype = ctypes.c_void_p
user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.MonitorFromWindow.restype = wintypes.HMONITOR
user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]

GWL_STYLE, GWLP_WNDPROC = -16, -4
WS_CAPTION, WS_THICKFRAME, WS_SYSMENU = 0x00C00000, 0x00040000, 0x00080000
WS_MINIMIZEBOX, WS_MAXIMIZEBOX = 0x00020000, 0x00010000
SNAP_STYLES = WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
WM_STYLECHANGING, WM_GETMINMAXINFO, WM_NCCALCSIZE, WM_NCLBUTTONDOWN, WM_DPICHANGED = 0x007C, 0x0024, 0x0083, 0x00A1, 0x02E0
SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE, SWP_FRAMECHANGED = 0x1, 0x2, 0x4, 0x10, 0x20
MONITOR_DEFAULTTONEAREST = 2
HIT = {"caption": 2, "left": 10, "right": 11, "top": 12, "top-left": 13, "top-right": 14,
       "bottom": 15, "bottom-left": 16, "bottom-right": 17}


class MINMAXINFO(ctypes.Structure):
    _fields_ = [("ptReserved", wintypes.POINT), ("ptMaxSize", wintypes.POINT), ("ptMaxPosition", wintypes.POINT),
                ("ptMinTrackSize", wintypes.POINT), ("ptMaxTrackSize", wintypes.POINT)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


class STYLESTRUCT(ctypes.Structure):
    _fields_ = [("styleOld", wintypes.DWORD), ("styleNew", wintypes.DWORD)]


def enable_per_monitor_dpi() -> None:
    """Must run before any window exists; pywebview's later SetProcessDPIAware() then becomes a no-op."""
    try:
        if user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):   # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            return
    except AttributeError:   # Windows 10 before 1703
        pass
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)   # per-monitor v1
    except Exception:
        pass


def work_area_logical() -> tuple[int, int, int, int, float]:
    """Primary monitor's work area (taskbar excluded) in logical pixels, plus its scale factor."""
    pt = wintypes.POINT(0, 0)
    user32.MonitorFromPoint.restype = wintypes.HMONITOR
    mon = user32.MonitorFromPoint(pt, 1)   # MONITOR_DEFAULTTOPRIMARY
    info = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
    user32.GetMonitorInfoW(mon, ctypes.byref(info))
    dpi_x, dpi_y = ctypes.c_uint(96), ctypes.c_uint(96)
    try:
        ctypes.windll.shcore.GetDpiForMonitor(mon, 0, ctypes.byref(dpi_x), ctypes.byref(dpi_y))
    except Exception:
        pass
    scale = dpi_x.value / 96 or 1.0
    w = info.rcWork
    return (int(w.left / scale), int(w.top / scale), int((w.right - w.left) / scale), int((w.bottom - w.top) / scale), scale)


class NativeFrame:
    """Installs the window-procedure hook on a pywebview WinForms form and starts native move / resize loops."""

    def __init__(self, form) -> None:
        self.form = form
        self.hwnd = wintypes.HWND(int(form.Handle.ToInt64()))
        self._old = None
        self._proc = WNDPROC(self._wndproc)   # keep a reference: the callback must outlive the hook

    # ── install ─────────────────────────────────────────────────────────
    def install(self) -> None:
        self._on_ui(self._install)

    def _install(self) -> None:
        self._old = user32.SetWindowLongPtrW(self.hwnd, GWLP_WNDPROC, ctypes.cast(self._proc, ctypes.c_void_p))
        style = user32.GetWindowLongPtrW(self.hwnd, GWL_STYLE) or 0
        user32.SetWindowLongPtrW(self.hwnd, GWL_STYLE, ctypes.c_void_p(style | SNAP_STYLES))
        user32.SetWindowPos(self.hwnd, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED)
        try:   # Windows 11: keep the rounded corners a framed window gets
            pref = ctypes.c_int(2)   # DWMWCP_ROUND
            ctypes.windll.dwmapi.DwmSetWindowAttribute(self.hwnd, 33, ctypes.byref(pref), ctypes.sizeof(pref))
        except Exception:
            pass
        log.info("native frame installed (snap styles on, per-monitor DPI %s)", self._dpi())

    def _wndproc(self, hwnd, msg, wparam, lparam):
        try:
            if msg == WM_NCCALCSIZE and wparam:
                if user32.IsZoomed(hwnd):   # maximised framed windows overhang the monitor by the frame width
                    self._clip_to_work_area(hwnd, ctypes.cast(lparam, ctypes.POINTER(wintypes.RECT)).contents)
                return 0   # client area = whole window: the frame the snap styles imply is never drawn
            if msg == WM_STYLECHANGING and ctypes.c_int(wparam).value == GWL_STYLE:
                ss = ctypes.cast(lparam, ctypes.POINTER(STYLESTRUCT)).contents
                ss.styleNew |= SNAP_STYLES   # WinForms re-applies its CreateParams now and then; keep Snap working
            elif msg == WM_GETMINMAXINFO:
                result = user32.CallWindowProcW(self._old, hwnd, msg, wparam, lparam)   # WinForms sets MinimumSize here
                self._fit_maximize(hwnd, ctypes.cast(lparam, ctypes.POINTER(MINMAXINFO)).contents)
                return result
            elif msg == WM_DPICHANGED:   # moved to a monitor with another scale: take the size Windows suggests
                r = ctypes.cast(lparam, ctypes.POINTER(wintypes.RECT)).contents
                user32.SetWindowPos(hwnd, None, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE)
                return 0
        except Exception:   # never let a Python error escape into the window procedure
            log.exception("native frame wndproc")
        return user32.CallWindowProcW(self._old, hwnd, msg, wparam, lparam)

    @staticmethod
    def _clip_to_work_area(hwnd, rc: wintypes.RECT) -> None:
        info = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
        if user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ctypes.byref(info)):
            w = info.rcWork
            rc.left, rc.top, rc.right, rc.bottom = max(rc.left, w.left), max(rc.top, w.top), min(rc.right, w.right), min(rc.bottom, w.bottom)

    @staticmethod
    def _fit_maximize(hwnd, mmi: MINMAXINFO) -> None:
        """Maximised = the monitor's work area, not the whole screen (borderless windows would cover the taskbar)."""
        info = MONITORINFO(cbSize=ctypes.sizeof(MONITORINFO))
        if not user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), ctypes.byref(info)):
            return
        work, mon = info.rcWork, info.rcMonitor
        mmi.ptMaxPosition.x, mmi.ptMaxPosition.y = work.left - mon.left, work.top - mon.top
        mmi.ptMaxSize.x, mmi.ptMaxSize.y = work.right - work.left, work.bottom - work.top

    def _dpi(self) -> int:
        try:
            return user32.GetDpiForWindow(self.hwnd)
        except Exception:
            return 96

    # ── native loops ────────────────────────────────────────────────────
    def start(self, what: str) -> bool:
        """Hand the pressed mouse button to Windows: 'caption' moves (with Snap), an edge name resizes."""
        hit = HIT.get(what)
        if hit is None:
            return False

        def go():
            pt = wintypes.POINT()
            user32.GetCursorPos(ctypes.byref(pt))
            user32.ReleaseCapture()
            user32.PostMessageW(self.hwnd, WM_NCLBUTTONDOWN, hit, (pt.y & 0xFFFF) << 16 | (pt.x & 0xFFFF))
        self._on_ui(go, wait=False)   # the move loop is modal: never block the JS bridge thread on it
        return True

    def _on_ui(self, fn, wait: bool = True) -> None:
        from System import Action
        if not self.form.InvokeRequired:
            fn()
        elif wait:
            self.form.Invoke(Action(fn))
        else:
            self.form.BeginInvoke(Action(fn))

"""
JARVIS Global Hotkey & Window Management Daemon
Registers Windows OS-wide shortcut Ctrl+Shift+J to summon JARVIS to mainstream.
Also exposes an HTTP endpoint on port 8789 for programmatic summoning.
"""

import sys
import time
import ctypes
from ctypes import wintypes
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

SW_HIDE = 0
SW_NORMAL = 1
SW_MINIMIZE = 6
SW_RESTORE = 9
SW_SHOW = 5

HOTKEY_ID = 1042
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_NOREPEAT = 0x4000
VK_J = 0x4A


def find_jarvis_window():
    """Finds the window handle for the JARVIS application window."""
    target_hwnd = None
    candidates = []

    def enum_cb(hwnd, _):
        if user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value
                lower = title.lower()
                if "j.a.r.v.i.s." in lower or (lower.startswith("jarvis") and "visual studio" not in lower and "code" not in lower):
                    candidates.append((hwnd, title))
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    user32.EnumWindows(WNDENUMPROC(enum_cb), 0)

    for hwnd, title in candidates:
        if "j.a.r.v.i.s." in title.lower():
            return hwnd

    if candidates:
        return candidates[0][0]

    return None


def summon_jarvis(toggle=False):
    """Brings JARVIS to mainstream foreground, or toggles if already focused."""
    hwnd = find_jarvis_window()
    if not hwnd:
        return False

    fg = user32.GetForegroundWindow()
    is_minimized = bool(user32.IsIconic(hwnd))

    if toggle and fg == hwnd and not is_minimized:
        # If already front and focused, minimize to background
        user32.ShowWindow(hwnd, SW_MINIMIZE)
        return True

    # Restore window if minimized
    user32.ShowWindow(hwnd, SW_RESTORE)

    # Force foreground window bypass using AttachThreadInput
    fore_thread = user32.GetWindowThreadProcessId(fg, None)
    current_thread = kernel32.GetCurrentThreadId()

    if fore_thread != current_thread:
        user32.AttachThreadInput(fore_thread, current_thread, True)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.AttachThreadInput(fore_thread, current_thread, False)
    else:
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)

    return True


class SummonHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        summon_jarvis(toggle=False)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()


def run_http_server():
    try:
        server = HTTPServer(('127.0.0.1', 8789), SummonHandler)
        server.serve_forever()
    except Exception as e:
        print(f"[hotkey] HTTP server error: {e}", file=sys.stderr)


def run_hotkey_loop():
    registered = user32.RegisterHotKey(None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_J)
    if not registered:
        registered = user32.RegisterHotKey(None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT, VK_J)

    if not registered:
        print("[hotkey] Could not register global shortcut Ctrl+Shift+J", file=sys.stderr)
        return

    print("[hotkey] Global shortcut registered: Ctrl+Shift+J -> Summon JARVIS")
    sys.stdout.flush()

    msg = wintypes.MSG()
    WM_HOTKEY = 0x0312

    try:
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            if msg.message == WM_HOTKEY and msg.wParam == HOTKEY_ID:
                summon_jarvis(toggle=True)
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
    finally:
        user32.UnregisterHotKey(None, HOTKEY_ID)


if __name__ == "__main__":
    t_http = threading.Thread(target=run_http_server, daemon=True)
    t_http.start()
    run_hotkey_loop()

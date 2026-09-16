"""
JARVIS Global Hotkey & Window Management Daemon
Registers Windows OS-wide shortcut Ctrl+Shift+J to summon JARVIS to mainstream.
Also exposes an HTTP endpoint on port 8789 for programmatic summoning.
"""

import sys
import os
import time
import socket
import subprocess
import threading
import ctypes
from ctypes import wintypes
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    import psutil
except ImportError:
    psutil = None

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

EXCLUDED_CLASSES = {
    "cabinetwclass",
    "explorewclass",
    "progman",
    "workerw",
    "consolewindowclass",
    "cascadia_hosting_window_class",
    "shell_traywnd",
}

EXCLUDED_PROCS = {
    "explorer.exe",
    "cmd.exe",
    "powershell.exe",
    "conhost.exe",
    "code.exe",
    "windowsterminal.exe",
}

EXCLUDED_TITLES = [
    "file explorer",
    "visual studio code",
    "command prompt",
    "windows powershell",
    "dev-c++",
]


def kill_existing_daemons():
    """Ensure no stale or duplicate hotkey daemon is running."""
    if not psutil:
        return
    current_pid = os.getpid()
    for p in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if p.info['pid'] != current_pid:
                cmd = ' '.join(p.info['cmdline'] or []).lower()
                if 'hotkey_daemon.py' in cmd:
                    p.terminate()
        except Exception:
            pass


def is_port_open(port):
    """Checks if a local TCP port is listening."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex(('127.0.0.1', port)) == 0


def find_browser():
    """Finds installed Chrome or Edge executable."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def get_jarvis_browser_pids():
    """Finds PIDs of Chrome/Edge instances launched for JARVIS."""
    pids = set()
    if not psutil:
        return pids
    for p in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            name = (p.info['name'] or '').lower()
            if name in ('chrome.exe', 'msedge.exe'):
                cmdline = ' '.join(p.info['cmdline'] or []).lower()
                if 'jarvis-app-data' in cmdline or 'localhost:5173' in cmdline or '127.0.0.1:5173' in cmdline:
                    pids.add(p.info['pid'])
        except Exception:
            pass
    return pids


def find_jarvis_window():
    """Finds the window handle for the JARVIS application window, strictly avoiding File Explorer."""
    jarvis_pids = get_jarvis_browser_pids()
    candidates = []

    def check_hwnd(hwnd):
        if not (user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd)):
            return

        cls_buff = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, cls_buff, 256)
        cls_name = cls_buff.value.lower()
        if cls_name in EXCLUDED_CLASSES:
            return

        length = user32.GetWindowTextLengthW(hwnd)
        tbuff = ctypes.create_unicode_buffer(length + 1)
        if length > 0:
            user32.GetWindowTextW(hwnd, tbuff, length + 1)
        title = tbuff.value
        title_lower = title.lower()

        if any(ex in title_lower for ex in EXCLUDED_TITLES):
            return

        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        if psutil:
            try:
                p = psutil.Process(pid.value)
                pname = p.name().lower()
                if pname in EXCLUDED_PROCS:
                    return
            except Exception:
                pass

        score = 0
        if pid.value in jarvis_pids and cls_name == "chrome_widgetwin_1":
            score += 100

        if "j.a.r.v.i.s." in title_lower and cls_name == "chrome_widgetwin_1":
            score += 90
        elif title_lower == "j.a.r.v.i.s.":
            score += 85
        elif ("localhost:5173" in title_lower or "127.0.0.1:5173" in title_lower) and cls_name == "chrome_widgetwin_1":
            score += 70
        elif title_lower == "localhost" and cls_name == "chrome_widgetwin_1":
            score += 60

        if score > 0:
            candidates.append((score, hwnd, title, cls_name, pid.value))

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def enum_cb(hwnd, lparam):
        check_hwnd(hwnd)
        return True

    hdesk = user32.OpenInputDesktop(0, False, 0x0100)
    if hdesk:
        user32.EnumDesktopWindows(hdesk, WNDENUMPROC(enum_cb), 0)
    user32.EnumWindows(WNDENUMPROC(enum_cb), 0)

    candidates.sort(key=lambda x: x[0], reverse=True)
    if candidates:
        return candidates[0][1]

    return None


def launch_jarvis():
    """Launches JARVIS interface if not currently running."""
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    # If Vite dev server is already running on port 5173, launch the Chrome app window directly
    if is_port_open(5173):
        browser = find_browser()
        if browser:
            profile_dir = os.path.expandvars(r"%LOCALAPPDATA%\JARVIS-App-Data")
            subprocess.Popen([
                browser,
                "--app=http://localhost:5173",
                f"--user-data-dir={profile_dir}",
                "--window-size=1400,900",
                "--autoplay-policy=no-user-gesture-required",
                "--enable-webgl",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ], cwd=project_dir)
            return True

    # Otherwise launch start.bat
    start_bat = os.path.join(project_dir, "start.bat")
    if os.path.exists(start_bat):
        subprocess.Popen(["cmd.exe", "/c", "start", "", "start.bat"], cwd=project_dir)
        return True

    return False


def summon_jarvis(toggle=False):
    """Brings JARVIS to mainstream foreground, or toggles if already focused."""
    hwnd = find_jarvis_window()
    if not hwnd:
        return launch_jarvis()

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
    for attempt in range(5):
        try:
            server = HTTPServer(('127.0.0.1', 8789), SummonHandler)
            server.serve_forever()
            break
        except Exception:
            time.sleep(0.3)


def run_hotkey_loop():
    kill_existing_daemons()
    time.sleep(0.2)

    registered = False
    for attempt in range(5):
        registered = user32.RegisterHotKey(None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_J)
        if not registered:
            registered = user32.RegisterHotKey(None, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT, VK_J)
        if registered:
            break
        time.sleep(0.25)

    if not registered:
        print("[hotkey] Could not register global shortcut Ctrl+Shift+J", file=sys.stderr)
        return

    print("[hotkey] Global shortcut registered: Ctrl+Shift+J -> Summon JARVIS Interface")
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

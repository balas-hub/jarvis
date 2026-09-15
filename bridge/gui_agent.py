"""
JARVIS Robotic GUI Automation Engine
Provides mouse control, keystrokes, window focus, UI Automation element discovery,
and arbitrary in-app GUI interaction for third-party Windows desktop software.
"""

import sys
import os
import json
import time
import tempfile
import ctypes
from ctypes import wintypes

def attach_to_default_desktop():
    try:
        user32 = ctypes.windll.user32
        DESKTOP_ALL = 0x01FF
        h_desk = user32.OpenDesktopW("default", 0, False, DESKTOP_ALL)
        if h_desk:
            user32.SetThreadDesktop(h_desk)
    except Exception:
        pass

attach_to_default_desktop()

import pyautogui
pyautogui.FAILSAFE = False

try:
    from PIL import ImageGrab
except ImportError:
    ImageGrab = None

try:
    import uiautomation as auto
    auto.SetGlobalSearchTimeout(2.5)
except ImportError:
    auto = None

user32 = ctypes.windll.user32


def get_screen_size():
    w = user32.GetSystemMetrics(0)
    h = user32.GetSystemMetrics(1)
    return w, h


def get_active_window_info():
    attach_to_default_desktop()
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None
    length = user32.GetWindowTextLengthW(hwnd)
    title = ""
    if length > 0:
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value

    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

    return {
        "hwnd": hwnd,
        "title": title,
        "pid": pid.value,
        "left": rect.left,
        "top": rect.top,
        "width": rect.right - rect.left,
        "height": rect.bottom - rect.top,
    }


def list_open_windows():
    attach_to_default_desktop()
    windows = []
    
    def enum_windows_proc(hwnd, lparam):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value.strip()
                if title and title not in ("Program Manager", "Windows Input Experience"):
                    rect = wintypes.RECT()
                    user32.GetWindowRect(hwnd, ctypes.byref(rect))
                    w = rect.right - rect.left
                    h = rect.bottom - rect.top
                    if w > 50 and h > 50:
                        windows.append({
                            "hwnd": hwnd,
                            "title": title,
                            "left": rect.left,
                            "top": rect.top,
                            "width": w,
                            "height": h
                        })
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(WNDENUMPROC(enum_windows_proc), 0)
    return windows


def focus_window_by_title(target_title):
    attach_to_default_desktop()
    target_lower = target_title.lower().strip()
    windows = list_open_windows()
    match = None

    for win in windows:
        wtitle = win["title"].lower()
        if target_lower == wtitle or target_lower in wtitle:
            match = win
            break

    if not match:
        return {"success": False, "error": f"No window found matching '{target_title}'"}

    hwnd = match["hwnd"]
    SW_RESTORE = 9
    user32.ShowWindow(hwnd, SW_RESTORE)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.15)
    return {
        "success": True,
        "title": match["title"],
        "hwnd": hwnd,
        "width": match["width"],
        "height": match["height"]
    }


def action_inspect():
    attach_to_default_desktop()
    sw, sh = get_screen_size()
    pos = pyautogui.position()
    fg = get_active_window_info()
    windows = list_open_windows()

    return {
        "screen_width": sw,
        "screen_height": sh,
        "mouse_x": pos.x,
        "mouse_y": pos.y,
        "active_window": fg,
        "open_windows": [w["title"] for w in windows[:15]],
    }


def action_click(x=None, y=None, button="left", clicks=1, duration=0.1):
    attach_to_default_desktop()
    if x is not None and y is not None:
        pyautogui.moveTo(int(x), int(y), duration=float(duration))
    current_pos = pyautogui.position()
    pyautogui.click(button=button, clicks=int(clicks))
    return {
        "success": True,
        "action": "click",
        "x": current_pos.x,
        "y": current_pos.y,
        "button": button,
        "clicks": clicks
    }


def action_move(x, y, duration=0.2):
    attach_to_default_desktop()
    pyautogui.moveTo(int(x), int(y), duration=float(duration))
    pos = pyautogui.position()
    return {"success": True, "action": "move", "x": pos.x, "y": pos.y}


def action_drag(from_x, from_y, to_x, to_y, duration=0.5, button="left"):
    attach_to_default_desktop()
    pyautogui.moveTo(int(from_x), int(from_y))
    pyautogui.dragTo(int(to_x), int(to_y), duration=float(duration), button=button)
    return {
        "success": True,
        "action": "drag",
        "from": [int(from_x), int(from_y)],
        "to": [int(to_x), int(to_y)],
        "button": button
    }


def action_scroll(amount, x=None, y=None):
    attach_to_default_desktop()
    if x is not None and y is not None:
        pyautogui.moveTo(int(x), int(y))
    pyautogui.scroll(int(amount))
    return {"success": True, "action": "scroll", "amount": int(amount)}


def action_type(text, press_enter=False, interval=0.01):
    attach_to_default_desktop()
    pyautogui.write(str(text), interval=float(interval))
    if press_enter:
        pyautogui.press("enter")
    return {"success": True, "action": "type", "text": text, "enter": press_enter}


def action_hotkey(keys):
    attach_to_default_desktop()
    if isinstance(keys, str):
        keys = [k.strip().lower() for k in keys.replace("+", ",").split(",") if k.strip()]
    pyautogui.hotkey(*keys)
    return {"success": True, "action": "hotkey", "keys": keys}


def action_press(key):
    attach_to_default_desktop()
    pyautogui.press(str(key).lower().strip())
    return {"success": True, "action": "press", "key": key}


def action_click_element(name, window=None, control_type=None, double_click=False):
    attach_to_default_desktop()
    if not auto:
        return {"success": False, "error": "uiautomation library not available"}

    if window:
        focus_res = focus_window_by_title(window)
        if not focus_res["success"]:
            return focus_res
        time.sleep(0.15)

    root = auto.GetRootControl()
    search_scope = root
    fg = user32.GetForegroundWindow()
    if fg:
        fg_ctrl = auto.ControlFromHandle(fg)
        if fg_ctrl:
            search_scope = fg_ctrl

    name_clean = name.strip()
    kwargs = {}
    if control_type:
        kwargs["ControlType"] = getattr(auto.ControlType, f"{control_type}Control", None)

    element = search_scope.Control(searchDepth=10, Name=name_clean, **kwargs)
    if not element.Exists(maxSearchSeconds=1.5):
        element = search_scope.Control(searchDepth=10, SubName=name_clean, **kwargs)

    if not element.Exists(maxSearchSeconds=1.5) and search_scope != root:
        element = root.Control(searchDepth=8, SubName=name_clean, **kwargs)

    if not element.Exists(maxSearchSeconds=1.0):
        return {"success": False, "error": f"Element '{name}' not found in UI tree."}

    rect = element.BoundingRectangle
    if rect.width() <= 0 or rect.height() <= 0:
        return {"success": False, "error": f"Element '{name}' found but has zero size (not clickable)."}

    cx = rect.left + rect.width() // 2
    cy = rect.top + rect.height() // 2

    pyautogui.moveTo(cx, cy, duration=0.15)
    pyautogui.click(clicks=2 if double_click else 1)

    return {
        "success": True,
        "name": element.Name,
        "control_type": element.ControlTypeName,
        "clicked_coords": [cx, cy],
        "bounding_rect": [rect.left, rect.top, rect.width(), rect.height()]
    }


def action_find_elements(window=None, max_depth=4):
    attach_to_default_desktop()
    if not auto:
        return {"success": False, "error": "uiautomation library not available"}

    if window:
        focus_res = focus_window_by_title(window)
        if not focus_res["success"]:
            return focus_res
        time.sleep(0.15)

    fg = user32.GetForegroundWindow()
    fg_ctrl = auto.ControlFromHandle(fg) if fg else auto.GetRootControl()

    interactive_types = {
        auto.ControlType.ButtonControl,
        auto.ControlType.MenuItemControl,
        auto.ControlType.TabItemControl,
        auto.ControlType.CheckBoxControl,
        auto.ControlType.RadioButtonControl,
        auto.ControlType.EditControl,
        auto.ControlType.ComboBoxControl,
        auto.ControlType.HyperlinkControl,
        auto.ControlType.SplitButtonControl,
        auto.ControlType.TreeItemControl,
        auto.ControlType.ListItemControl,
    }

    elements = []
    
    def walk(ctrl, depth):
        if depth > max_depth or len(elements) >= 50:
            return
        for child in ctrl.GetChildren():
            try:
                name = child.Name.strip()
                rect = child.BoundingRectangle
                if name and child.ControlType in interactive_types and rect.width() > 0:
                    elements.append({
                        "name": name,
                        "type": child.ControlTypeName,
                        "center": [rect.left + rect.width() // 2, rect.top + rect.height() // 2]
                    })
                walk(child, depth + 1)
            except Exception:
                pass

    walk(fg_ctrl, 1)
    fg_title = ""
    try:
        fg_title = fg_ctrl.Name
    except Exception:
        pass

    return {
        "window": fg_title,
        "count": len(elements),
        "elements": elements
    }


def action_screenshot(save_path=None):
    attach_to_default_desktop()
    if not ImageGrab:
        return {"success": False, "error": "PIL ImageGrab not available"}

    img = ImageGrab.grab()
    if not save_path:
        out_dir = tempfile.gettempdir()
        save_path = os.path.join(out_dir, f"jarvis_screen_{int(time.time()*1000)}.png")

    img.save(save_path)
    return {
        "success": True,
        "path": save_path,
        "width": img.width,
        "height": img.height
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No action specified"}))
        sys.exit(1)

    action = sys.argv[1].lower()
    args = {}

    # Read args from sys.argv[2] or if --stdin is specified
    if len(sys.argv) > 2:
        if sys.argv[2] == "--stdin":
            raw_in = sys.stdin.read().strip()
            if raw_in:
                try:
                    args = json.loads(raw_in)
                except Exception:
                    args = {"param": raw_in}
        else:
            try:
                args = json.loads(sys.argv[2])
            except Exception:
                args = {"param": sys.argv[2]}

    try:
        if action == "inspect":
            result = action_inspect()
        elif action == "focus_window":
            title = args.get("title") or args.get("name") or args.get("param", "")
            result = focus_window_by_title(title)
        elif action == "click":
            result = action_click(
                x=args.get("x"),
                y=args.get("y"),
                button=args.get("button", "left"),
                clicks=int(args.get("clicks", 1)),
                duration=float(args.get("duration", 0.1))
            )
        elif action == "move":
            result = action_move(
                x=int(args.get("x", 0)),
                y=int(args.get("y", 0)),
                duration=float(args.get("duration", 0.2))
            )
        elif action == "drag":
            result = action_drag(
                from_x=int(args.get("from_x", 0)),
                from_y=int(args.get("from_y", 0)),
                to_x=int(args.get("to_x", 0)),
                to_y=int(args.get("to_y", 0)),
                duration=float(args.get("duration", 0.5)),
                button=args.get("button", "left")
            )
        elif action == "scroll":
            result = action_scroll(
                amount=int(args.get("amount", -300)),
                x=args.get("x"),
                y=args.get("y")
            )
        elif action == "type":
            result = action_type(
                text=str(args.get("text", "")),
                press_enter=bool(args.get("press_enter", False) or args.get("enter", False)),
                interval=float(args.get("interval", 0.01))
            )
        elif action == "hotkey":
            keys = args.get("keys") or args.get("param", "")
            result = action_hotkey(keys)
        elif action == "press":
            key = args.get("key") or args.get("param", "enter")
            result = action_press(key)
        elif action == "click_element":
            result = action_click_element(
                name=args.get("name") or args.get("param", ""),
                window=args.get("window"),
                control_type=args.get("control_type"),
                double_click=bool(args.get("double_click", False))
            )
        elif action == "find_elements":
            result = action_find_elements(
                window=args.get("window"),
                max_depth=int(args.get("max_depth", 4))
            )
        elif action == "screenshot":
            result = action_screenshot(save_path=args.get("path"))
        else:
            result = {"error": f"Unknown action: {action}"}

        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()

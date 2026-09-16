/**
 * JARVIS Google Antigravity / Gemini Bridge Engine.
 *
 * Uses the Google Gen AI SDK (@google/genai) to drive JARVIS with Gemini models
 * (gemini-3.7-flash by default) with automatic multi-model fallback for quota & high-demand resilience.
 *
 * It streams speech tokens down the WebSocket in real time for instant TTS,
 * executes UI/HUD tools (ui_theme, ui_reactor, display, blade, etc.),
 * provides FULL Windows PC access (PowerShell commands, opening apps, filesystem, system info/control),
 * supports vision captures from the camera, and handles instant barge-in.
 */

import { GoogleGenAI } from '@google/genai'
import dns from 'node:dns'
import { exec, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { enrollPerson, identifyPerson, listPeople, renamePerson, deletePerson } from './faces.mjs'

// Prefer IPv4 on Windows to prevent IPv6 connect timeout
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // ignore
}

/** Multi-model fallback pool to eliminate 429 quota and 503 high-demand errors */
export const MODEL_FALLBACK_POOL = [
  process.env.GEMINI_MODEL,
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.7-flash',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
].filter(Boolean)

const UNIQUE_MODELS = [...new Set(MODEL_FALLBACK_POOL)]
let activeModelIdx = 0

/** Function definitions exposed to Gemini */
export const GEMINI_TOOLS = [
  // --- HUD & Holographic Controls ---
  {
    name: 'display',
    description: 'Display an interactive HUD panel or data card on screen.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Header title for the panel.' },
        html: {
          type: 'STRING',
          description:
            'HTML markup using .hud-* classes (e.g. <div class="hud-stat"><span class="hud-stat-value">98%</span><span class="hud-stat-label">POWER</span></div>, or .hud-card, .hud-badge, .hud-progress).'
        },
        style: {
          type: 'STRING',
          description: 'Panel visual style: panel, card, stat, code, or badge.',
          enum: ['panel', 'card', 'stat', 'code', 'badge']
        }
      },
      required: ['html']
    }
  },
  {
    name: 'blade',
    description: 'Display a large content blade on the side of the interface for detailed reading or data display.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Title of the blade.' },
        html: { type: 'STRING', description: 'HTML content of the blade.' }
      },
      required: ['title', 'html']
    }
  },
  {
    name: 'ui_theme',
    description: 'Change the visual holographic interface theme, accent color, or background.',
    parameters: {
      type: 'OBJECT',
      properties: {
        palette: {
          type: 'STRING',
          description: 'Named palette: classic (cyan), stealth (amber), tactical (military), infrared (red), ultraviolet (violet), matrix (green), synthwave (neon), glacier (ice blue), sol (gold).'
        },
        accent: { type: 'STRING', description: 'Custom accent color hex (e.g. #00ffff).' },
        background: { type: 'STRING', description: 'Custom background tint hex.' }
      }
    }
  },
  {
    name: 'ui_reactor',
    description: 'Control the holographic 3D arc reactor appearance, color, spin, scale, intensity, or geometry.',
    parameters: {
      type: 'OBJECT',
      properties: {
        color: { type: 'STRING', description: 'Hex or color name for the reactor core.' },
        style: { type: 'STRING', description: 'Reactor style: ring, sphere, wire, or auto.', enum: ['ring', 'sphere', 'wire', 'auto'] },
        spin: { type: 'NUMBER', description: 'Rotation speed multiplier (0 to 5).' },
        scale: { type: 'NUMBER', description: 'Scale multiplier (0.5 to 2.5).' },
        intensity: { type: 'NUMBER', description: 'Glow intensity multiplier (0 to 3).' },
        visible: { type: 'BOOLEAN', description: 'Show or hide the arc reactor.' }
      }
    }
  },
  {
    name: 'ui_orbit',
    description: 'Place images or cards in 3D orbit around the central arc reactor.',
    parameters: {
      type: 'OBJECT',
      properties: {
        images: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Array of image URLs to float in orbit.'
        },
        visible: { type: 'BOOLEAN', description: 'Whether orbiting objects are visible.' },
        speed: { type: 'NUMBER', description: 'Orbit rotation speed multiplier.' }
      }
    }
  },
  {
    name: 'ui_effect',
    description: 'Trigger a visual screen effect: glitch, pulse, scan, shake, or flash.',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: {
          type: 'STRING',
          description: 'Effect name: glitch, pulse, scan, shake, flash.',
          enum: ['glitch', 'pulse', 'scan', 'shake', 'flash']
        }
      },
      required: ['type']
    }
  },
  {
    name: 'ui_chrome',
    description: 'Show or hide UI interface elements: side rails, bottom transcript, top status badges.',
    parameters: {
      type: 'OBJECT',
      properties: {
        rails: { type: 'BOOLEAN', description: 'Side rails visibility.' },
        transcript: { type: 'BOOLEAN', description: 'Bottom transcript visibility.' },
        badges: { type: 'BOOLEAN', description: 'Status badges visibility.' }
      }
    }
  },
  {
    name: 'ui_screen',
    description: 'Clear active panels from the screen.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'Screen action.', enum: ['clear'] }
      },
      required: ['action']
    }
  },
  {
    name: 'ui_reset',
    description: 'Reset interface theme, reactor, and HUD back to defaults.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'ui_gestures',
    description: 'Enable or disable webcam hand gesture tracking and touchless holographic controls.',
    parameters: {
      type: 'OBJECT',
      properties: {
        enabled: { type: 'BOOLEAN', description: 'True to activate hand gesture tracking; false to deactivate.' }
      },
      required: ['enabled']
    }
  },
  {
    name: 'ui_playground',
    description: 'Enter or exit 3D holographic playground mode for touchless gesture drawing with index finger, two-finger erasing, pinch drag & drop, and 5-finger 3D rotation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        active: { type: 'BOOLEAN', description: 'True to activate 3D playground mode, false to deactivate.' }
      },
      required: ['active']
    }
  },
  {
    name: 'face_db',
    description: 'Biometric facial database to assign names to people, recognize individuals on camera, list known people, or update records.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'Action: enroll (assign name to person in front of camera), identify (recognize who is in front of camera), list (view all enrolled people), rename (change name of person), delete (remove person).',
          enum: ['enroll', 'identify', 'list', 'rename', 'delete']
        },
        name: { type: 'STRING', description: 'Name of the person (required for enroll, rename, delete).' },
        newName: { type: 'STRING', description: 'New name for the person when action is rename.' },
        notes: { type: 'STRING', description: 'Relationship or description notes (e.g. "Creator", "Friend", "Teammate") when action is enroll.' }
      },
      required: ['action']
    }
  },
  {
    name: 'look',
    description: 'Capture a real-time frame from the user webcam to inspect what they are showing or looking at.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: { type: 'STRING', description: 'Why you need to inspect the camera feed.' }
      }
    }
  },

  // --- Full PC Access & Windows Automation Tools ---
  {
    name: 'system_run',
    description: 'Execute a PowerShell or command-line command on the user\'s Windows PC. Use this to run scripts, query system info, control software, automate Windows tasks, check network, inspect hardware, etc.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'The PowerShell command line string to execute.' },
        cwd: { type: 'STRING', description: 'Optional directory path to execute the command in.' }
      },
      required: ['command']
    }
  },
  {
    name: 'open_app',
    description: 'Launch an application, document, folder, or URL on the user\'s Windows PC (e.g. spotify, chrome, notepad, calculator, code, explorer, terminal, steam, etc.).',
    parameters: {
      type: 'OBJECT',
      properties: {
        target: { type: 'STRING', description: 'Name of the app (e.g. "spotify", "chrome", "notepad", "calculator", "explorer", "code"), or a file path or URL to open.' },
        args: { type: 'STRING', description: 'Optional command-line arguments to pass to the application.' }
      },
      required: ['target']
    }
  },
  {
    name: 'fs_read',
    description: 'Read the text contents of a file from anywhere on the user\'s PC.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Absolute or relative path to the file to read.' },
        maxLines: { type: 'INTEGER', description: 'Optional maximum number of lines to return (defaults to 150).' }
      },
      required: ['path']
    }
  },
  {
    name: 'fs_write',
    description: 'Create or overwrite a text file anywhere on the user\'s PC disk.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Destination file path.' },
        content: { type: 'STRING', description: 'Text contents to write to the file.' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'fs_list',
    description: 'List directories and files in any folder on the PC (e.g. Desktop, Documents, C:\\, F:\\, etc.).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Folder path to list. If omitted or empty, lists the user home directory.' }
      }
    }
  },
  {
    name: 'system_info',
    description: 'Get real-time Windows PC statistics: OS version, CPU, RAM usage, storage/disk space, battery, and active processes.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'system_control',
    description: 'Control PC hardware settings, volume, media playback, lock, sleep, shutdown, restart, or take a screenshot.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'Action to perform on Windows.',
          enum: [
            'volume_up',
            'volume_down',
            'mute',
            'unmute',
            'volume_max',
            'media_play_pause',
            'media_next',
            'media_prev',
            'screenshot',
            'lock',
            'sleep',
            'restart',
            'shutdown',
            'empty_recycle_bin'
          ]
        }
      },
      required: ['action']
    }
  },
  {
    name: 'process_kill',
    description: 'Terminate a running Windows process by application name (e.g. "chrome", "notepad", "spotify") or process ID (PID).',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Name of the process or executable to stop (e.g. "notepad", "chrome.exe").' },
        pid: { type: 'INTEGER', description: 'Optional process ID to terminate.' }
      }
    }
  },
  {
    name: 'fs_delete',
    description: 'Delete a file or directory from the user\'s PC disk.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File or directory path to delete.' },
        recursive: { type: 'BOOLEAN', description: 'True to delete directory contents recursively.' }
      },
      required: ['path']
    }
  },

  // --- Arbitrary In-App GUI Automation Tools ---
  {
    name: 'gui_inspect',
    description: 'Inspect real-time desktop GUI status: screen resolution, current mouse cursor coordinates, active foreground window title/size, and list of all open application windows.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'gui_focus_window',
    description: 'Bring an open application window to the foreground and restore it if minimized (e.g. "Premiere", "Photoshop", "Notepad", "Chrome", "Blender", "File Explorer").',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Application window title or substring (e.g. "Premiere", "Photoshop", "Notepad").' }
      },
      required: ['title']
    }
  },
  {
    name: 'gui_click',
    description: 'Physically click the mouse at specific screen coordinates (x, y) or at the current mouse position. Supports left, right, or middle clicks, and single or double clicks.',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'INTEGER', description: 'Optional screen X coordinate in pixels.' },
        y: { type: 'INTEGER', description: 'Optional screen Y coordinate in pixels.' },
        button: { type: 'STRING', description: 'Mouse button to click.', enum: ['left', 'right', 'middle'] },
        clicks: { type: 'INTEGER', description: 'Number of clicks: 1 for single click, 2 for double click.' },
        duration: { type: 'NUMBER', description: 'Seconds to move mouse smoothly to target (default: 0.1).' }
      }
    }
  },
  {
    name: 'gui_move',
    description: 'Move the mouse cursor smoothly to target screen coordinates (x, y).',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'INTEGER', description: 'Target screen X coordinate.' },
        y: { type: 'INTEGER', description: 'Target screen Y coordinate.' },
        duration: { type: 'NUMBER', description: 'Seconds for smooth movement (default: 0.2).' }
      },
      required: ['x', 'y']
    }
  },
  {
    name: 'gui_drag',
    description: 'Click and drag the mouse from one coordinate to another. Essential for moving sliders, scrubbing video/audio timelines, moving clips, and selecting regions in desktop software (e.g. Adobe Premiere, Photoshop, 3D apps).',
    parameters: {
      type: 'OBJECT',
      properties: {
        from_x: { type: 'INTEGER', description: 'Starting X coordinate.' },
        from_y: { type: 'INTEGER', description: 'Starting Y coordinate.' },
        to_x: { type: 'INTEGER', description: 'Ending X coordinate.' },
        to_y: { type: 'INTEGER', description: 'Ending Y coordinate.' },
        button: { type: 'STRING', description: 'Button to drag with (left or right).', enum: ['left', 'right'] },
        duration: { type: 'NUMBER', description: 'Duration in seconds for the drag operation (default: 0.5).' }
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y']
    }
  },
  {
    name: 'gui_type',
    description: 'Type arbitrary text into the currently focused text field, dialog, or input box.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The text string to type into the active field.' },
        press_enter: { type: 'BOOLEAN', description: 'Whether to press Enter after typing the text.' }
      },
      required: ['text']
    }
  },
  {
    name: 'gui_hotkey',
    description: 'Trigger in-app keyboard shortcuts and hotkeys (e.g. "ctrl+s" to save, "ctrl+m" to export video, "alt+f4" to close, "ctrl+z" to undo, "space" to play/pause, "alt+f" to open File menu).',
    parameters: {
      type: 'OBJECT',
      properties: {
        keys: { type: 'STRING', description: 'Key combination (e.g. "ctrl+s", "ctrl+m", "alt+f", "ctrl+shift+esc").' }
      },
      required: ['keys']
    }
  },
  {
    name: 'gui_press',
    description: 'Press an individual keyboard key (e.g. "enter", "esc", "tab", "backspace", "delete", "space", "f5", "up", "down").',
    parameters: {
      type: 'OBJECT',
      properties: {
        key: { type: 'STRING', description: 'Key name to press (e.g. "enter", "esc", "tab", "space", "f5", "delete").' }
      },
      required: ['key']
    }
  },
  {
    name: 'gui_scroll',
    description: 'Scroll the mouse wheel up or down at optional screen coordinates.',
    parameters: {
      type: 'OBJECT',
      properties: {
        amount: { type: 'INTEGER', description: 'Scroll amount: positive number scrolls up, negative number scrolls down (e.g. -300 or 300).' },
        x: { type: 'INTEGER', description: 'Optional screen X coordinate to scroll at.' },
        y: { type: 'INTEGER', description: 'Optional screen Y coordinate to scroll at.' }
      },
      required: ['amount']
    }
  },
  {
    name: 'gui_click_button',
    description: 'Find any button, menu item, tab, or clickable UI element by its text label (e.g. "File", "Export", "Render", "Save", "OK", "Cancel", "Effects", "Timeline") inside third-party desktop software using Windows UIAutomation and click its exact position.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Label or text of the button or menu item to click (e.g. "Export", "Render", "File", "Save").' },
        window: { type: 'STRING', description: 'Optional window title containing the element (e.g. "Premiere", "Photoshop", "Notepad").' },
        control_type: { type: 'STRING', description: 'Optional UI control type filter.', enum: ['Button', 'MenuItem', 'TabItem', 'CheckBox', 'RadioButton', 'Edit', 'Hyperlink'] },
        double_click: { type: 'BOOLEAN', description: 'True to double click the element.' }
      },
      required: ['name']
    }
  },
  {
    name: 'gui_find_elements',
    description: 'Scan the currently active or specified application window and list all clickable buttons, menus, tabs, and input controls with their screen coordinates.',
    parameters: {
      type: 'OBJECT',
      properties: {
        window: { type: 'STRING', description: 'Optional window title to inspect. If omitted, inspects the currently active window.' },
        max_depth: { type: 'INTEGER', description: 'Maximum UI tree search depth (default: 4).' }
      }
    }
  },
  {
    name: 'gui_screenshot',
    description: 'Capture a full-screen screenshot of the user\'s desktop to inspect active software layout, dialogue boxes, or menus.',
    parameters: {
      type: 'OBJECT',
      properties: {
        save_path: { type: 'STRING', description: 'Optional file path to save the screenshot PNG.' }
      }
    }
  },
  {
    name: 'whatsapp_send',
    description: 'Send or draft a WhatsApp message to a phone number or contact on Windows. Opens WhatsApp, selects the chat, and types the message.',
    parameters: {
      type: 'OBJECT',
      properties: {
        recipient: { type: 'STRING', description: 'Phone number with country code (e.g. "+919876543210") or contact name (e.g. "Mom", "John").' },
        message: { type: 'STRING', description: 'The text message to send.' },
        auto_send: { type: 'BOOLEAN', description: 'True to automatically send immediately; False to stage it in the input box for user review (default: true).' }
      },
      required: ['recipient', 'message']
    }
  }
]

/**
 * Spawns bridge/gui_agent.py to execute desktop GUI robotic actions.
 */
function runGuiAction(action, args = {}) {
  return new Promise((resolve) => {
    const pythonCmd = 'python'
    const scriptPath = path.resolve('bridge/gui_agent.py')
    const child = spawn(pythonCmd, [scriptPath, action, '--stdin'])
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })

    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        resolve({ success: false, error: stderr.trim() || `Exited with code ${code}` })
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        resolve({ success: code === 0, raw: stdout.trim(), error: stderr.trim() })
      }
    })

    child.on('error', (err) => {
      resolve({ success: false, error: `Failed to launch python: ${err.message}` })
    })

    child.stdin.write(JSON.stringify(args))
    child.stdin.end()
  })
}

/**
 * Creates a reusable tool executor for local PC automation and HUD features.
 */
export function createToolExecutor({ send, announceTool, settleTool, ask, ai, getModel }) {
  return async function executeTool(name, args = {}, askId = null) {
    announceTool(null, name)
    try {
      if (name === 'display') {
        const id = `b-${Date.now()}`
        send({
          type: 'panel',
          panel: {
            id,
            title: args.title || 'STATUS',
            html: args.html,
            style: args.style || 'panel',
            at: Date.now(),
          },
        })
        send({
          type: 'blade',
          blade: {
            id,
            title: args.title || 'STATUS',
            kind: 'markup',
            html: args.html,
            size: 'compact',
            hold: 'turn',
            at: Date.now(),
          },
        })
        settleTool(null, false)
        return { success: true, message: 'Panel and blade displayed.' }
      }

      if (name === 'blade') {
        send({
          type: 'blade',
          blade: {
            id: `b-${Date.now()}`,
            title: args.title || 'INFORMATION',
            kind: args.kind || 'markup',
            url: args.url,
            images: args.images,
            html: args.html,
            size: args.size || 'compact',
            hold: args.hold || 'turn',
            at: Date.now(),
          },
        })
        settleTool(null, false)
        return { success: true, message: 'Blade opened.' }
      }

      if (name.startsWith('ui_')) {
        const op = name.replace(/^ui_/, '')
        send({ type: 'ui', op, args })
        settleTool(null, false)
        return { success: true, message: `Interface updated: ${op}.` }
      }

      if (name === 'look') {
        const capture = await ask('capture', {
          mode: 'look',
          reason: args.reason || 'visual inspection',
          seconds: 1,
          when: 'now',
        })
        settleTool(null, false)
        return {
          success: true,
          image_captured: true,
          mimeType: capture.mimeType || 'image/jpeg',
          info: 'Frame captured successfully.',
        }
      if (name === 'ui_playground') {
        const active = Boolean(args.active)
        send({ type: 'ui', op: 'playground', args: { active } })
        if (active) {
          send({ type: 'ui', op: 'gestures', args: { enabled: true } })
        }
        settleTool(null, false)
        return {
          success: true,
          active,
          message: active
            ? '3D Holographic Playground mode activated. Gesture drawing with index finger, two-finger erase, pinch drag-and-drop, and 5-finger 3D rotation are now online.'
            : '3D Holographic Playground mode deactivated.',
        }
      }

      if (name === 'face_db') {
        const action = args.action || 'list'
        const activeModel = getModel ? getModel() : UNIQUE_MODELS[0]

        if (action === 'enroll') {
          if (!args.name) {
            settleTool(null, false)
            return { error: 'Name is required to enroll someone in the facial database.' }
          }
          const capture = await ask('capture', {
            mode: 'look',
            reason: `Biometric facial enrollment for ${args.name}`,
            seconds: 1,
            when: 'now',
          })
          if (!capture?.data) {
            settleTool(null, false)
            return { error: 'Could not capture camera frame for facial enrollment.' }
          }
          const record = await enrollPerson({
            name: args.name,
            notes: args.notes || '',
            imageBase64: capture.data,
            mimeType: capture.mimeType || 'image/jpeg',
            ai,
            model: activeModel,
          })
          const id = `b-${Date.now()}`
          send({
            type: 'panel',
            panel: {
              id,
              title: 'BIOMETRICS ENROLLED',
              html: `<div class="hud-stat"><span class="hud-stat-value">${record.name.toUpperCase()}</span><span class="hud-stat-label">FACIAL PROFILE SAVED</span></div><p style="color:var(--text-dim,#88a);font-size:12px;margin-top:6px;">${record.features}</p>`,
              style: 'panel',
              at: Date.now(),
            },
          })
          send({ type: 'ui', op: 'face_enrolled', args: record })
          settleTool(null, false)
          return {
            success: true,
            person: record,
            message: `Successfully enrolled ${record.name} into the facial database.`,
          }
        }

        if (action === 'identify') {
          const capture = await ask('capture', {
            mode: 'look',
            reason: 'Identifying person in front of the camera',
            seconds: 1,
            when: 'now',
          })
          if (!capture?.data) {
            settleTool(null, false)
            return { error: 'Could not capture camera frame for facial identification.' }
          }
          const result = await identifyPerson({
            imageBase64: capture.data,
            mimeType: capture.mimeType || 'image/jpeg',
            ai,
            model: activeModel,
          })
          if (result.matched && result.name) {
            const id = `b-${Date.now()}`
            send({
              type: 'panel',
              panel: {
                id,
                title: 'BIOMETRIC MATCH',
                html: `<div class="hud-stat"><span class="hud-stat-value">${result.name.toUpperCase()}</span><span class="hud-stat-label">CONFIDENCE: ${(result.confidence * 100).toFixed(0)}%</span></div><p style="color:var(--text-dim,#88a);font-size:12px;margin-top:6px;">${result.explanation || result.notes || 'Identified from facial database'}</p>`,
                style: 'panel',
                at: Date.now(),
              },
            })
            send({ type: 'ui', op: 'face_identified', args: result })
          }
          settleTool(null, false)
          return result
        }

        if (action === 'list') {
          const people = listPeople()
          const rows = people.length
            ? people
                .map(
                  (p) =>
                    `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.1);"><strong style="color:var(--hud-accent,#00ffff);font-size:14px;">${p.name}</strong> <span style="opacity:0.6;font-size:11px;">(${p.notes || 'User'})</span><div style="font-size:11px;opacity:0.75;margin-top:2px;">${p.features || 'No features recorded'}</div></div>`,
                )
                .join('')
            : '<p style="opacity:0.6;">No individuals enrolled yet.</p>'
          send({
            type: 'blade',
            blade: {
              id: `b-${Date.now()}`,
              title: 'FACIAL DATABASE',
              kind: 'markup',
              html: `<div style="padding:16px;"><h3>ENROLLED BIOMETRIC PROFILES (${people.length})</h3>${rows}</div>`,
              size: 'compact',
              hold: 'turn',
              at: Date.now(),
            },
          })
          settleTool(null, false)
          return { success: true, count: people.length, people }
        }

        if (action === 'rename') {
          const updated = renamePerson(args.name, args.newName)
          settleTool(null, false)
          return updated
            ? { success: true, message: `Renamed to ${updated.name}`, person: updated }
            : { error: `Could not find person "${args.name}" to rename.` }
        }

        if (action === 'delete') {
          const ok = deletePerson(args.name)
          settleTool(null, false)
          return ok
            ? { success: true, message: `Removed "${args.name}" from facial database.` }
            : { error: `Could not find person "${args.name}" to remove.` }
        }
      }
      if (name === 'system_run') {
        const cmd = args.command
        const runCwd = args.cwd || process.cwd()
        console.log(`[gemini-bridge] Executing command: ${cmd} (cwd: ${runCwd})`)
        const result = await new Promise((resolve) => {
          exec(cmd, { cwd: runCwd, shell: 'powershell.exe', timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({
              stdout: stdout ? stdout.slice(0, 4000) : '',
              stderr: stderr ? stderr.slice(0, 2000) : '',
              exitCode: err ? (err.code ?? 1) : 0,
              error: err ? err.message : null,
            })
          })
        })
        settleTool(null, false)
        return result
      }

      if (name === 'open_app') {
        const target = (args.target || '').trim()
        console.log(`[gemini-bridge] Launching application/target: ${target}`)
        const lower = target.toLowerCase()
        const siteMap = {
          youtube: 'https://www.youtube.com',
          google: 'https://www.google.com',
          github: 'https://www.github.com',
          gmail: 'https://mail.google.com',
          whatsapp: 'https://web.whatsapp.com',
          twitter: 'https://x.com',
          x: 'https://x.com',
          reddit: 'https://www.reddit.com',
          chatgpt: 'https://chatgpt.com',
          netflix: 'https://www.netflix.com',
          spotify_web: 'https://open.spotify.com',
          linkedin: 'https://www.linkedin.com',
          instagram: 'https://www.instagram.com',
        }
        const appMap = {
          calc: 'calc.exe',
          calculator: 'calc.exe',
          notepad: 'notepad.exe',
          chrome: 'chrome',
          browser: 'start http://',
          edge: 'msedge.exe',
          explorer: 'explorer.exe',
          files: 'explorer.exe',
          file_explorer: 'explorer.exe',
          spotify: 'spotify',
          cmd: 'cmd.exe',
          terminal: 'wt.exe',
          powershell: 'powershell.exe',
          code: 'code',
          vscode: 'code',
          taskmgr: 'taskmgr.exe',
          settings: 'ms-settings:',
          control: 'control.exe',
          control_panel: 'control.exe',
          paint: 'mspaint.exe',
          camera: 'microsoft.windows.camera:',
          vlc: 'vlc.exe',
          word: 'winword.exe',
          excel: 'excel.exe',
          powerpoint: 'powerpnt.exe',
        }

        let runTarget = siteMap[lower] || appMap[lower] || target
        if (/^(https?:\/\/|www\.)/i.test(runTarget)) {
          if (runTarget.startsWith('www.')) runTarget = `https://${runTarget}`
        }

        const psArgs = args.args ? ` -ArgumentList '${args.args.replace(/'/g, "''")}'` : ''
        const cmd = `Start-Process "${runTarget.replace(/"/g, '`"')}"${psArgs}`

        const result = await new Promise((resolve) => {
          exec(cmd, { shell: 'powershell.exe', timeout: 15000 }, (err) => {
            if (err) {
              exec(`start "" "${runTarget}"`, (err2) => {
                if (err2) resolve({ success: false, error: err2.message })
                else resolve({ success: true, message: `Opened ${target}` })
              })
            } else {
              resolve({ success: true, message: `Launched ${target}` })
            }
          })
        })
        settleTool(null, false)
        return result
      }

      if (name === 'fs_read') {
        const filePath = path.resolve(args.path)
        try {
          const data = fs.readFileSync(filePath, 'utf8')
          const maxLines = args.maxLines || 150
          const lines = data.split('\n')
          const truncated = lines.length > maxLines
          const content = lines.slice(0, maxLines).join('\n')
          settleTool(null, false)
          return {
            path: filePath,
            content,
            totalLines: lines.length,
            truncated,
          }
        } catch (err) {
          settleTool(null, true)
          return { error: `Failed to read file ${filePath}: ${err.message}` }
        }
      }

      if (name === 'fs_write') {
        const filePath = path.resolve(args.path)
        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, args.content, 'utf8')
          settleTool(null, false)
          return { success: true, path: filePath, bytesWritten: Buffer.byteLength(args.content, 'utf8') }
        } catch (err) {
          settleTool(null, true)
          return { error: `Failed to write file ${filePath}: ${err.message}` }
        }
      }

      if (name === 'fs_list') {
        const targetDir = args.path ? path.resolve(args.path) : os.homedir()
        try {
          const entries = fs.readdirSync(targetDir, { withFileTypes: true })
          const items = entries.slice(0, 100).map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
          }))
          settleTool(null, false)
          return { path: targetDir, totalCount: entries.length, items }
        } catch (err) {
          settleTool(null, true)
          return { error: `Failed to list directory ${targetDir}: ${err.message}` }
        }
      }

      if (name === 'system_info') {
        const psScript = `
          $os = Get-CimInstance Win32_OperatingSystem
          $cs = Get-CimInstance Win32_ComputerSystem
          $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, LoadPercentage
          $drives = Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='FreeGB';E={[math]::Round($_.Free/1GB,1)}}, @{N='UsedGB';E={[math]::Round($_.Used/1GB,1)}}
          $topProc = Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 ProcessName, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB,1)}}
          @{
            OS = $os.Caption
            HostName = $cs.Name
            TotalRAM_GB = [math]::Round($os.TotalVisibleMemorySize/1MB, 1)
            FreeRAM_GB = [math]::Round($os.FreePhysicalMemory/1MB, 1)
            CPU = $cpu.Name
            CPULoadPercent = $cpu.LoadPercentage
            Drives = $drives
            TopProcesses = $topProc
          } | ConvertTo-Json -Depth 3 -Compress
        `
        const result = await new Promise((resolve) => {
          exec(psScript, { shell: 'powershell.exe', timeout: 15000 }, (err, stdout) => {
            if (err || !stdout) {
              resolve({
                os: `${os.type()} ${os.release()}`,
                arch: os.arch(),
                freeMemMB: Math.round(os.freemem() / 1024 / 1024),
                totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
                cpus: os.cpus().length,
              })
            } else {
              try {
                resolve(JSON.parse(stdout))
              } catch {
                resolve({ raw: stdout.trim() })
              }
            }
          })
        })
        settleTool(null, false)
        return result
      }

      if (name === 'system_control') {
        const action = args.action
        const mediaActions = [
          'volume_up',
          'volume_down',
          'mute',
          'unmute',
          'volume_max',
          'media_play_pause',
          'media_next',
          'media_prev',
        ]

        if (mediaActions.includes(action)) {
          const res = await runGuiAction('media_key', { key: action })
          settleTool(null, !res.success)
          return res
        }

        if (action === 'screenshot') {
          const res = await runGuiAction('screenshot', {})
          settleTool(null, !res.success)
          return res
        }

        let psCmd = ''
        if (action === 'lock') {
          psCmd = 'rundll32.exe user32.dll,LockWorkStation'
        } else if (action === 'sleep') {
          psCmd = 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
        } else if (action === 'restart') {
          psCmd = 'shutdown.exe /r /t 5'
        } else if (action === 'shutdown') {
          psCmd = 'shutdown.exe /s /t 10'
        } else if (action === 'empty_recycle_bin') {
          psCmd = 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'
        }

        const result = await new Promise((resolve) => {
          exec(psCmd, { shell: 'powershell.exe', timeout: 12000 }, (err, stdout) => {
            if (err) resolve({ success: false, error: err.message })
            else resolve({ success: true, action, output: stdout ? stdout.trim() : 'Action executed.' })
          })
        })
        settleTool(null, false)
        return result
      }

      if (name === 'process_kill') {
        const procName = args.name ? args.name.replace(/\.exe$/i, '') : null
        const pid = args.pid
        let psCmd = ''
        if (pid) {
          psCmd = `Stop-Process -Id ${pid} -Force`
        } else if (procName) {
          psCmd = `Stop-Process -Name "${procName}" -Force -ErrorAction SilentlyContinue`
        } else {
          settleTool(null, true)
          return { error: 'Must provide either process name or pid to kill.' }
        }
        const result = await new Promise((resolve) => {
          exec(psCmd, { shell: 'powershell.exe', timeout: 8000 }, (err) => {
            if (err) resolve({ success: false, error: err.message })
            else resolve({ success: true, message: `Terminated ${procName || pid}` })
          })
        })
        settleTool(null, false)
        return result
      }

      if (name === 'fs_delete') {
        const targetPath = path.resolve(args.path)
        try {
          if (!fs.existsSync(targetPath)) {
            settleTool(null, false)
            return { success: false, message: 'Target path does not exist.' }
          }
          const isDir = fs.statSync(targetPath).isDirectory()
          if (isDir) {
            fs.rmSync(targetPath, { recursive: Boolean(args.recursive), force: true })
          } else {
            fs.unlinkSync(targetPath)
          }
          settleTool(null, false)
          return { success: true, deleted: targetPath }
        } catch (err) {
          settleTool(null, true)
          return { error: `Failed to delete ${targetPath}: ${err.message}` }
        }
      }

      if (name.startsWith('gui_')) {
        const action = name.replace(/^gui_/, '')
        let result
        if (action === 'click_button') {
          result = await runGuiAction('click_element', args)
        } else if (action === 'find_elements') {
          result = await runGuiAction('find_elements', args)
        } else if (action === 'focus_window') {
          result = await runGuiAction('focus_window', args)
        } else if (action === 'screenshot') {
          result = await runGuiAction('screenshot', args)
        } else {
          result = await runGuiAction(action, args)
        }
        settleTool(null, !result.success && Boolean(result.error))
        return result
      }

      if (name === 'whatsapp_send') {
        const recipient = String(args.recipient || '').trim()
        const message = String(args.message || '').trim()
        const autoSend = args.auto_send !== false

        if (!recipient || !message) {
          settleTool(null, true)
          return { error: 'Recipient and message are required.' }
        }

        const digits = recipient.replace(/\D/g, '')
        const isPhoneNumber = digits.length >= 7

        if (isPhoneNumber) {
          const encodedMsg = encodeURIComponent(message)
          const uri = `whatsapp://send?phone=${digits}&text=${encodedMsg}`
          const cmd = `Start-Process "${uri}"`

          await new Promise((resolve) => {
            exec(cmd, { shell: 'powershell.exe', timeout: 10000 }, () => resolve())
          })

          if (autoSend) {
            await runGuiAction('wait_for_window', { title: 'WhatsApp', timeout: 3.5 })
            await new Promise((r) => setTimeout(r, 250))
            await runGuiAction('press', { key: 'enter' })
          }

          settleTool(null, false)
          return {
            success: true,
            method: 'protocol',
            recipient: digits,
            message,
            dispatched: autoSend,
            note: autoSend ? 'Message sent via WhatsApp' : 'Message staged in WhatsApp input box'
          }
        } else {
          await new Promise((resolve) => {
            exec('Start-Process "whatsapp:"', { shell: 'powershell.exe', timeout: 10000 }, () => resolve())
          })
          
          await runGuiAction('wait_for_window', { title: 'WhatsApp', timeout: 3.5 })
          await new Promise((r) => setTimeout(r, 120))

          await runGuiAction('hotkey', { keys: 'ctrl+f' })
          await new Promise((r) => setTimeout(r, 150))

          await runGuiAction('type', { text: recipient, press_enter: true })
          await new Promise((r) => setTimeout(r, 350))

          await runGuiAction('type', { text: message, press_enter: autoSend })

          settleTool(null, false)
          return {
            success: true,
            method: 'gui_search',
            recipient,
            message,
            dispatched: autoSend,
            note: autoSend ? `Message sent to ${recipient}` : `Message staged for ${recipient}`
          }
        }
      }

      settleTool(null, true)
      return { error: `Unknown tool: ${name}` }
    } catch (err) {
      settleTool(null, true)
      return { error: err.message || String(err) }
    }
  }
}

/**
 * Creates a Gemini chat session for a connected browser WebSocket.
 */
export function createGeminiSession({
  send,
  ask,
  sendTurn,
  announceTool,
  settleTool,
  systemPrompt,
  apiKey,
}) {
  const key = apiKey || process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY is not set. Set GEMINI_API_KEY in your environment or .env.local.')
  }

  const ai = new GoogleGenAI({
    apiKey: key,
    httpOptions: { timeout: 45000 },
  })

  let currentChat = null
  let activeTurn = null
  let cancelled = false
  let currentModel = UNIQUE_MODELS[activeModelIdx % UNIQUE_MODELS.length]

  function initChat(modelName = currentModel) {
    currentModel = modelName
    console.log(`[gemini-bridge] Initializing session with model: ${currentModel}`)
    const now = new Date()
    const liveClock = `\n\nCurrent Real-Time System Clock: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true })} (Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}). You have direct real-time access to the user's PC clock, hardware, and files.`

    currentChat = ai.chats.create({
      model: currentModel,
      config: {
        systemInstruction: systemPrompt + liveClock,
        temperature: 0.7,
        tools: [{ functionDeclarations: GEMINI_TOOLS }],
      },
    })
  }
  const executeTool = createToolExecutor({ send, announceTool, settleTool, ask, ai, getModel: () => currentModel })

  return {
    async handleAsk(userText, askId) {
      cancelled = false
      activeTurn = askId
      let fullText = ''

      let attempts = 0
      const maxModelAttempts = UNIQUE_MODELS.length * 2

      while (attempts < maxModelAttempts) {
        try {
          if (!currentChat) initChat()

          // Turn loop to handle tool calls and continuations
          let currentInput = userText
          let maxToolLoops = 6

          while (maxToolLoops-- > 0) {
            if (cancelled) break

            const streamResult = await currentChat.sendMessageStream({ message: currentInput })
            let functionCallsToRun = []

            for await (const chunk of streamResult) {
              if (cancelled) break

              if (chunk.text) {
                fullText += chunk.text
                sendTurn({ type: 'text', delta: chunk.text })
              }

              if (chunk.functionCalls && chunk.functionCalls.length > 0) {
                functionCallsToRun.push(...chunk.functionCalls)
              }
            }

            if (cancelled || functionCallsToRun.length === 0) {
              break
            }

            // Execute all function calls requested by Gemini
            const toolResponses = []
            for (const call of functionCallsToRun) {
              const toolResult = await executeTool(call.name, call.args || {}, askId)
              toolResponses.push({
                functionResponse: {
                  name: call.name,
                  response: toolResult,
                  id: call.id,
                },
              })
            }

            // Pass the function execution results back to Gemini
            currentInput = toolResponses
          }

          if (!cancelled) {
            sendTurn({
              type: 'done',
              text: fullText.trim(),
              model: currentModel,
            })
          }
          // Turn completed successfully
          return
        } catch (err) {
          const errStr = String(err?.message || err)
          const isRetryableError =
            errStr.includes('429') ||
            errStr.includes('RESOURCE_EXHAUSTED') ||
            errStr.includes('404') ||
            errStr.includes('503') ||
            errStr.includes('UNAVAILABLE') ||
            errStr.includes('high demand') ||
            errStr.includes('quota') ||
            errStr.includes('limit') ||
            errStr.includes('ConnectTimeoutError') ||
            errStr.includes('UND_ERR_CONNECT_TIMEOUT') ||
            errStr.includes('fetch failed')

          if (isRetryableError && attempts < maxModelAttempts - 1) {
            const oldModel = currentModel
            activeModelIdx = (activeModelIdx + 1) % UNIQUE_MODELS.length
            const newModel = UNIQUE_MODELS[activeModelIdx]
            console.warn(`[gemini-bridge] Model ${oldModel} hit rate limit / high demand or transient error (${errStr.slice(0, 80)}...). Auto-switching to model ${newModel}...`)
            attempts++
            initChat(newModel)
            fullText = ''
            // Small backoff
            await new Promise(r => setTimeout(r, 800))
            continue
          }

          console.error('[gemini-bridge] turn error:', err)
          let userMessage = 'I encountered an issue processing that command, sir.'
          if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
            userMessage = 'API quota reached on all available models. Please retry in a moment, sir.'
          }
          sendTurn({
            type: 'error',
            message: userMessage,
          })
          return
        } finally {
          if (activeTurn === askId) {
            activeTurn = null
          }
        }
      }
    },

    interrupt() {
      cancelled = true
      activeTurn = null
    },

    close() {
      cancelled = true
      currentChat = null
    },
  }
}

const { app, BrowserWindow, session, Tray, Menu, nativeImage, globalShortcut, ipcMain } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')

// Prevent Chromium hardware acceleration glitches while ensuring WebGL performance
app.commandLine.appendSwitch('enable-webgl')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('enable-features', 'SpeechRecognition,MediaStreamTrack')

let mainWindow = null
let tray = null
let isQuitting = false
let balloonShown = false
const children = []

const VITE_PORT = process.env.PORT || 5173
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || `http://localhost:${VITE_PORT}`

// Check if a local HTTP server is listening on a port
function isPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, () => {
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(800, () => {
      req.destroy()
      resolve(false)
    })
  })
}

// Check if Bridge server is listening on port 8787
function isBridgeOpen() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:8787', () => resolve(true))
    req.on('error', () => resolve(false))
    req.setTimeout(800, () => {
      req.destroy()
      resolve(false)
    })
  })
}

// Spawn background services if not already running
async function ensureServices() {
  const bridgeRunning = await isBridgeOpen()
  if (!bridgeRunning) {
    console.log('[desktop-electron] Spawning JARVIS background bridge...')
    const bridge = spawn('node', ['bridge/server.mjs'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, JARVIS_ALLOW_WRITES: '1' },
      stdio: 'inherit',
      shell: false,
    })
    children.push(bridge)
  }

  const viteRunning = await isPortOpen(VITE_PORT)
  if (!viteRunning) {
    console.log('[desktop-electron] Spawning Vite interface service...')
    const viteBin = path.resolve(__dirname, '../node_modules/vite/bin/vite.js')
    const vite = spawn(process.execPath, [viteBin], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env },
      stdio: 'inherit',
      shell: false,
    })
    children.push(vite)
  }
}

function getTrayIcon() {
  const iconPath = path.resolve(__dirname, '../public/tray-icon.png')
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath)
  }
  // Fallback: create empty native image
  return nativeImage.createEmpty()
}

function createTray() {
  if (tray) return
  const icon = getTrayIcon()
  tray = new Tray(icon)
  tray.setToolTip('J.A.R.V.I.S. — Online (Gemini AI)')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open J.A.R.V.I.S. (Ctrl+Shift+J)',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      },
    },
    { type: 'separator' },
    {
      label: '● Engine: Gemini 3.5 Flash',
      enabled: false,
    },
    {
      label: '● Background Listening: Active',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Toggle Developer Tools',
      click: () => {
        if (mainWindow) mainWindow.webContents.toggleDevTools()
      },
    },
    {
      label: 'Reload Interface',
      click: () => {
        if (mainWindow) mainWindow.reload()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit J.A.R.V.I.S.',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: 'J.A.R.V.I.S.',
    backgroundColor: '#02080c',
    show: false,
    frame: true,
    autoHideMenuBar: true,
    icon: getTrayIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
      backgroundThrottling: false, // CRUCIAL: Keeps audio and wake-word listening 100% active in background
    },
  })

  // Auto-grant microphone, camera, and media permissions
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'camera') {
      return true
    }
    return false
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'camera') {
      return callback(true)
    }
    return callback(false)
  })

  mainWindow.setMenuBarVisibility(false)

  // Intercept window close to minimize/hide to System Tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
      if (!balloonShown && tray && process.platform === 'win32') {
        balloonShown = true
        try {
          tray.displayBalloon({
            title: 'J.A.R.V.I.S. is in Standby',
            content: 'Running in the background. Say "Hey Jarvis" or press Ctrl+Shift+J to summon.',
          })
        } catch {}
      }
      return false
    }
  })

  // Poll dev server until ready, then show
  const loadURL = async () => {
    try {
      await mainWindow.loadURL(VITE_DEV_SERVER_URL)
      mainWindow.show()
    } catch {
      setTimeout(loadURL, 800)
    }
  }

  loadURL()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// Register IPC handlers for custom desktop controls
ipcMain.on('desktop:minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.on('desktop:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  }
})

ipcMain.on('desktop:hide', () => {
  if (mainWindow) mainWindow.hide()
})

ipcMain.on('desktop:quit', () => {
  isQuitting = true
  app.quit()
})

ipcMain.on('desktop:summon', () => {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
})

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.on('before-quit', () => {
    isQuitting = true
    for (const child of children) {
      try {
        child.kill('SIGTERM')
      } catch {}
    }
  })

  app.whenReady().then(async () => {
    await ensureServices()
    createTray()
    createWindow()

    // Register global shortcut to summon JARVIS from anywhere
    try {
      globalShortcut.register('CommandOrControl+Shift+J', () => {
        if (!mainWindow) return
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      })
    } catch (err) {
      console.warn('Could not register global shortcut:', err)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      }
    })
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) {
      app.quit()
    }
  })
}

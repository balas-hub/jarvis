const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvisDesktop', {
  isDesktop: true,
  minimize: () => ipcRenderer.send('desktop:minimize'),
  maximize: () => ipcRenderer.send('desktop:maximize'),
  hideToTray: () => ipcRenderer.send('desktop:hide'),
  quit: () => ipcRenderer.send('desktop:quit'),
  summon: () => ipcRenderer.send('desktop:summon'),
})

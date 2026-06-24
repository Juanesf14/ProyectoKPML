const { contextBridge, ipcRenderer } = require('electron')

// Expose a minimal, explicit API surface to the renderer process.
// contextIsolation (set in main.js) ensures the renderer cannot reach
// raw ipcRenderer or any other Node/Electron internals.
contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder:    ()         => ipcRenderer.invoke('select-folder'),
  selectFile:      ()         => ipcRenderer.invoke('select-file'),
  readFolder:      (path)     => ipcRenderer.invoke('read-folder', path),
  renameFile:      (paths)    => ipcRenderer.invoke('rename-file', paths),
  /**
   * Reads a local file and returns { base64, mimeType } for data-URL previews.
   * Returns null if the path is invalid or the file does not exist.
   */
  readFileBase64:  (filePath) => ipcRenderer.invoke('read-file-base64', filePath),

  // Admin-only database backup/restore (manual). The renderer gates these to
  // admins; the dialogs and file I/O run in the main process.
  backupDatabase:  ()         => ipcRenderer.invoke('backup-database'),
  restoreDatabase: ()         => ipcRenderer.invoke('restore-database'),
})
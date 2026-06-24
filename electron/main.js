const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const isProd = app.isPackaged

/**
 * Checks GitHub Releases for a newer version and, once an update is downloaded
 * in the background, asks the user whether to restart and install it.
 * Only runs in packaged builds; errors are swallowed so a failed update check
 * (e.g. offline) never disrupts normal use.
 */
function setupAutoUpdates(win) {
  if (!isProd) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'Restart the app to apply the update.',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })

  autoUpdater.on('error', (err) => {
    console.error('[auto-update] error:', err?.message || err)
  })

  autoUpdater.checkForUpdates().catch(err =>
    console.error('[auto-update] check failed:', err?.message || err)
  )
}

// Distinct app name so this ML build keeps its own userData directory, separate
// from the standard RenamerJF build. Must run before app 'ready'. Critical on
// Windows/macOS case-insensitive filesystems where "renamerjf" and "RenamerJF"
// would otherwise resolve to the same folder and the two apps would share data.
app.setName('RenamerJF ML')

/**
 * Points DB_PATH to the OS user-data directory so the database survives
 * app updates (which would otherwise wipe the app bundle's working dir).
 */
function ensureDatabase() {
  const userDataDb = path.join(app.getPath('userData'), 'renamerjf.db')
  process.env.DB_PATH = userDataDb
  fs.mkdirSync(path.dirname(userDataDb), { recursive: true })
}

/**
 * Boots the Express backend in-process. Only runs in packaged (production) builds;
 * in dev the backend is started separately via `npm run dev` in the backend folder.
 *
 * Seed credentials are read from the .env before first launch:
 *   SEED_ADMIN_NAME / EMAIL / PASSWORD
 *   SEED_USER_NAME  / EMAIL / PASSWORD
 */
function startBackend() {
  if (!isProd) return

  ensureDatabase()

  process.env.NODE_ENV = 'production'
  process.env.PORT     = process.env.PORT || '3001'

  // Generate a persistent JWT secret on first launch and reuse it across restarts
  // so existing tokens stay valid after an update.
  if (!process.env.JWT_SECRET) {
    const secretFile = path.join(app.getPath('userData'), '.jwt_secret')
    if (fs.existsSync(secretFile)) {
      process.env.JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim()
    } else {
      const secret = crypto.randomBytes(32).toString('hex')
      fs.writeFileSync(secretFile, secret)
      process.env.JWT_SECRET = secret
    }
  }

  try {
    require('../backend/src/index.js')
    console.log('[backend] started on port', process.env.PORT)
  } catch (err) {
    console.error('[backend] startup error:', err)
    dialog.showErrorBox('Backend startup error', err.message + '\n\n' + err.stack)
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0D1B2A',  // matches the app so no white flash on load
    // Hide the native menu bar (File/Edit/View/...). On macOS the menu lives in
    // the system bar; on Windows/Linux it would otherwise render inside the
    // window. autoHideMenuBar keeps it out of the way (Alt still reveals it).
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // renderer cannot access Node APIs directly
      nodeIntegration: false,
    },
  })

  if (isProd) {
    win.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'))
  } else {
    win.loadURL('http://localhost:5173')
  }

  setupAutoUpdates(win)
  return win
}

app.whenReady().then(() => {
  applyPendingRestore()
  startBackend()
  // In production, give the backend time to bind its port before the window loads.
  const delay = isProd ? 1500 : 0
  setTimeout(createWindow, delay)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Normalise Windows backslashes so the frontend can use the path in string operations.
const normPath = p => (p || '').replace(/\\/g, '/')

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : normPath(result.filePaths[0])
})

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      {
        name: 'Documents & Images',
        extensions: ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp'],
      },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (result.canceled) return null
  const filePath = result.filePaths[0]
  const name = path.basename(filePath)
  return { name, path: normPath(filePath) }
})

ipcMain.handle('read-folder', async (_, folderPath) => {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true })
  return entries
    .filter(e => e.isFile())
    .map(e => ({ name: e.name, path: normPath(path.join(folderPath, e.name)) }))
})

ipcMain.handle('rename-file', async (_, { oldPath, newPath }) => {
  fs.renameSync(oldPath, newPath)
  return { success: true }
})

// MIME types for every file extension the analyzer and previewer support.
const PREVIEW_MIME = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.tiff': 'image/tiff',
  '.tif':  'image/tiff',
  '.bmp':  'image/bmp',
  '.webp': 'image/webp',
}

/**
 * Returns the file at filePath as a base64 string plus its MIME type.
 * The renderer uses these to build a data-URL preview (iframe for PDFs,
 * <img> for images) without relaxing webSecurity or registering custom protocols.
 *
 * Returns null for non-existent or relative paths so the renderer can
 * show a graceful "preview not available" state.
 */
ipcMain.handle('read-file-base64', (_, filePath) => {
  if (!filePath || !path.isAbsolute(filePath)) return null
  if (!fs.existsSync(filePath)) return null
  const ext      = path.extname(filePath).toLowerCase()
  const mimeType = PREVIEW_MIME[ext] || 'application/octet-stream'
  const buffer   = fs.readFileSync(filePath)
  return { base64: buffer.toString('base64'), mimeType }
})

// Resolves the live database file path (same logic as the backend's schema.js).
function getDbPath() {
  return process.env.DB_PATH || path.join(app.getPath('userData'), 'renamerjf.db')
}

// Exports a consistent, hot copy of the database to a user-chosen location.
// Uses better-sqlite3's online backup so an in-flight write can't corrupt the copy.
ipcMain.handle('backup-database', async () => {
  const dbPath = getDbPath()
  if (!fs.existsSync(dbPath)) return { success: false, error: 'Database not found' }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export database backup',
    defaultPath: `renamerjf-backup-${stamp}.db`,
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  })
  if (canceled || !filePath) return { success: false, canceled: true }

  try {
    const Database = require('better-sqlite3')
    const src = new Database(dbPath, { readonly: true })
    await src.backup(filePath)
    src.close()
    return { success: true, path: filePath }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Restores the database from a backup file chosen by the user. Validates that
// the file is a usable SQLite DB with the expected schema, keeps a safety copy
// of the current DB, swaps it in, then relaunches the app.
ipcMain.handle('restore-database', async () => {
  const dbPath = getDbPath()

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Restore database from backup',
    properties: ['openFile'],
    filters: [{ name: 'SQLite database', extensions: ['db'] }],
  })
  if (canceled || !filePaths?.[0]) return { success: false, canceled: true }
  const source = filePaths[0]

  // Validate the chosen file before overwriting anything.
  try {
    const Database = require('better-sqlite3')
    const test = new Database(source, { readonly: true })
    const ok = test.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    ).get()
    test.close()
    if (!ok) return { success: false, error: 'Not a valid RenamerJF database (missing users table)' }
  } catch {
    return { success: false, error: 'The selected file is not a valid SQLite database' }
  }

  const confirm = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Restore and restart', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Restore database',
    message: 'This will replace all current data with the backup.',
    detail: 'A safety copy of the current database is kept. The app will restart.',
  })
  if (confirm.response !== 0) return { success: false, canceled: true }

  try {
    // Stage the restore instead of overwriting the live (open) DB file — on
    // Windows the backend holds it open. applyPendingRestore() swaps it in at
    // next startup, before the backend opens the database.
    fs.copyFileSync(source, `${dbPath}.pending`)
  } catch (err) {
    return { success: false, error: err.message }
  }

  app.relaunch()
  app.exit(0)
  return { success: true }
})

// If a restore was staged, swap it in before the backend opens the DB. Keeps a
// one-shot safety copy of the database that was active just before the restore.
function applyPendingRestore() {
  const dbPath  = path.join(app.getPath('userData'), 'renamerjf.db')
  const pending = `${dbPath}.pending`
  if (!fs.existsSync(pending)) return
  try {
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, `${dbPath}.pre-restore`)
    fs.renameSync(pending, dbPath)
    console.log('[restore] applied staged database backup')
  } catch (err) {
    console.error('[restore] failed to apply staged backup:', err.message)
  }
}

const Database = require('better-sqlite3')
const bcrypt = require('bcryptjs')
const { v4: uuidv4 } = require('uuid')
const path = require('path')

// DB_PATH is injected by main.js in production to point to the OS userData directory.
// The fallback path is used during development.
const dbPath = process.env.DB_PATH || path.join(__dirname, '../../renamerjf.db')
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    specialty TEXT,
    phone TEXT,
    fax TEXT,
    email TEXT,
    address TEXT,
    hours TEXT,
    portal_url TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS document_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rename_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider_id TEXT,
    doc_type_id INTEGER,
    original_name TEXT NOT NULL,
    new_name TEXT NOT NULL,
    dos_start TEXT,
    dos_end TEXT,
    update_date TEXT,
    pip_exhausted INTEGER DEFAULT 0,
    renamed_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (doc_type_id) REFERENCES document_types(id)
  );

  CREATE TABLE IF NOT EXISTS billing_summaries (
    id TEXT PRIMARY KEY,
    case_num TEXT,
    provider_id TEXT,
    file_path TEXT,
    total_charges REAL DEFAULT 0,
    total_adjustments REAL DEFAULT 0,
    pip_paid REAL DEFAULT 0,
    health_ins_paid REAL DEFAULT 0,
    patient_paid REAL DEFAULT 0,
    outstanding REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    source TEXT DEFAULT 'local',
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT,
    FOREIGN KEY (case_num) REFERENCES cases(num),
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    num TEXT UNIQUE NOT NULL,
    created TEXT, last TEXT, first TEXT, rb TEXT, dol TEXT, open TEXT,
    c15 TEXT, c21 TEXT, c99 TEXT, c99b TEXT,
    migrated TEXT, fu TEXT, taskflow TEXT, phase TEXT,
    qd TEXT, qddue TEXT, gsd TEXT, gscdue TEXT, routed TEXT,
    urb TEXT, notes TEXT, bv TEXT, bvdue TEXT, completed TEXT,
    added_on TEXT DEFAULT (datetime('now')),
    source TEXT DEFAULT 'manual'
  );
`)

// Seed/reconcile document types. INSERT OR IGNORE makes this idempotent and adds
// any missing types to existing installs (e.g. HL / PIP, which the renamer
// supports but earlier seeds were missing). Codes are used as filename prefixes.
const docTypeSeeds = [
  ['B',   'Medical Bills'],
  ['MR',  'Medical Records'],
  ['HL',  'Health Lien'],
  ['PIP', 'PIP Log'],
  ['PD',  'Police Report'],
  ['LT',  'Letter'],
  ['RX',  'Prescription'],
  ['IN',  'Insurance'],
  ['OT',  'Other'],
]
const insertDocType = db.prepare('INSERT OR IGNORE INTO document_types (code, label) VALUES (?, ?)')
for (const [code, label] of docTypeSeeds) insertDocType.run(code, label)

// Seed initial users from environment variables on first launch.
// Credentials are defined in .env and never committed to source control.
// Partial seeds are supported: rows with missing name/email/password are skipped.
const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get()
if (usersCount.count === 0) {
  const seedUsers = [
    { name: process.env.SEED_ADMIN_NAME,  email: process.env.SEED_ADMIN_EMAIL,  password: process.env.SEED_ADMIN_PASSWORD,  role: 'admin' },
    { name: process.env.SEED_USER_NAME,   email: process.env.SEED_USER_EMAIL,   password: process.env.SEED_USER_PASSWORD,   role: 'user'  },
    { name: process.env.SEED_USER2_NAME,  email: process.env.SEED_USER2_EMAIL,  password: process.env.SEED_USER2_PASSWORD,  role: 'user'  },
  ]
  const insertUser = db.prepare(
    'INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)'
  )
  for (const u of seedUsers) {
    if (u.name && u.email && u.password) {
      insertUser.run(uuidv4(), u.name, u.email, bcrypt.hashSync(u.password, 10), u.role)
      console.log(`User seeded: ${u.email} (${u.role})`)
    }
  }
}

module.exports = db
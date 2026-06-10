const express = require('express')
const { v4: uuidv4 } = require('uuid')
const Fuse = require('fuse.js')
const db = require('../db/schema')
const { authMiddleware, adminMiddleware } = require('../middleware/auth')

const router = express.Router()

// All provider routes require a valid JWT.
router.use(authMiddleware)

// GET /api/providers — returns all providers, optionally filtered by name/specialty or type.
router.get('/', (req, res) => {
  const { q, type } = req.query
  let query = 'SELECT * FROM providers WHERE 1=1'
  const params = []
  if (q) {
    query += ' AND (name LIKE ? OR specialty LIKE ?)'
    params.push(`%${q}%`, `%${q}%`)
  }
  if (type) {
    query += ' AND type = ?'
    params.push(type)
  }
  query += ' ORDER BY name ASC'
  const providers = db.prepare(query).all(...params)
  res.json(providers)
})

// POST /api/providers/suggest — fuzzy-matches a free-text string against provider names.
// Used by the frontend to let users search without selecting from a dropdown.
router.post('/suggest', (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'Text is required' })
  const providers = db.prepare('SELECT id, name FROM providers').all()
  if (providers.length === 0) return res.json({ suggestion: null })
  const fuse = new Fuse(providers, { keys: ['name'], threshold: 0.4, includeScore: true })
  const results = fuse.search(text)
  if (results.length === 0) return res.json({ suggestion: null })
  const best = results[0]
  const confidence = +(1 - best.score).toFixed(2)
  res.json({
    suggestion: {
      provider_id: best.item.id,
      name: best.item.name,
      confidence,
      method: 'fuzzy',
    }
  })
})

// GET /api/providers/:id — returns provider details plus their full rename history.
router.get('/:id', (req, res) => {
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id)
  if (!provider) return res.status(404).json({ error: 'Provider not found' })
  const history = db.prepare(`
    SELECT rh.*, dt.code, dt.label
    FROM rename_history rh
    LEFT JOIN document_types dt ON rh.doc_type_id = dt.id
    WHERE rh.provider_id = ?
    ORDER BY rh.renamed_at DESC
  `).all(req.params.id)
  res.json({ provider, history })
})

// Write operations (create/update/delete) are restricted to admin users.
router.post('/', adminMiddleware, (req, res) => {
  const { name, type, specialty, phone, fax, email, address, hours, portal_url, notes } = req.body
  if (!name || !type) return res.status(400).json({ error: 'Name and type are required' })
  const id = uuidv4()
  db.prepare(`
    INSERT INTO providers (id, name, type, specialty, phone, fax, email, address, hours, portal_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type, specialty, phone, fax, email, address, hours, portal_url, notes)
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(id)
  res.status(201).json(provider)
})

router.put('/:id', adminMiddleware, (req, res) => {
  const { name, type, specialty, phone, fax, email, address, hours, portal_url, notes } = req.body
  const exists = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id)
  if (!exists) return res.status(404).json({ error: 'Provider not found' })
  db.prepare(`
    UPDATE providers SET
      name = ?, type = ?, specialty = ?, phone = ?, fax = ?,
      email = ?, address = ?, hours = ?, portal_url = ?, notes = ?
    WHERE id = ?
  `).run(name, type, specialty, phone, fax, email, address, hours, portal_url, notes, req.params.id)
  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id)
  res.json(provider)
})

router.delete('/:id', adminMiddleware, (req, res) => {
  const exists = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id)
  if (!exists) return res.status(404).json({ error: 'Provider not found' })
  db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id)
  res.json({ success: true })
})

// POST /api/providers/import — bulk-insert providers from a CSV-parsed array.
// Rows with a name that already exists (case-insensitive) are skipped.
// Body: { providers: [ { name, type, specialty, phone, fax, email, address, hours, portal_url, notes }, … ] }
router.post('/import', adminMiddleware, (req, res) => {
  const rows = req.body?.providers
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'providers array is required' })
  }

  const insert = db.prepare(`
    INSERT INTO providers (id, name, type, specialty, phone, fax, email, address, hours, portal_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const checkName = db.prepare('SELECT id FROM providers WHERE LOWER(name) = LOWER(?)')

  let imported = 0
  let skipped  = 0

  const importAll = db.transaction(() => {
    for (const row of rows) {
      const name = (row.name || '').trim()
      if (!name) { skipped++; continue }

      if (checkName.get(name)) { skipped++; continue }

      const type = row.type || 'Medical Provider'
      insert.run(
        uuidv4(), name, type,
        row.specialty   || null,
        row.phone       || null,
        row.fax         || null,
        row.email       || null,
        row.address     || null,
        row.hours       || null,
        row.portal_url  || null,
        row.notes       || null,
      )
      imported++
    }
  })

  importAll()
  res.json({ imported, skipped })
})

module.exports = router
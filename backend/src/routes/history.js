const express = require('express')
const { v4: uuidv4 } = require('uuid')
const db = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

const router = express.Router()

router.use(authMiddleware)

// POST /api/history — records a completed rename operation for audit and reporting.
// pip_exhausted is stored as a SQLite integer (0/1) since SQLite has no boolean type.
router.post('/', (req, res) => {
  const {
    provider_id,
    doc_type_id,
    original_name,
    new_name,
    dos_start,
    dos_end,
    update_date,
    pip_exhausted,
  } = req.body

  if (!original_name || !new_name)
    return res.status(400).json({ error: 'Original and new file names are required' })

  const id      = uuidv4()
  const user_id = req.user.id

  db.prepare(`
    INSERT INTO rename_history (
      id, user_id, provider_id, doc_type_id,
      original_name, new_name, dos_start, dos_end,
      update_date, pip_exhausted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, user_id, provider_id, doc_type_id,
    original_name, new_name, dos_start, dos_end,
    update_date, pip_exhausted ? 1 : 0
  )

  const record = db.prepare('SELECT * FROM rename_history WHERE id = ?').get(id)
  res.status(201).json(record)
})

// GET /api/history — returns rename history for the currently authenticated user only.
router.get('/', (req, res) => {
  const history = db.prepare(`
    SELECT rh.*, dt.code, dt.label, p.name as provider_name
    FROM rename_history rh
    LEFT JOIN document_types dt ON rh.doc_type_id = dt.id
    LEFT JOIN providers p ON rh.provider_id = p.id
    WHERE rh.user_id = ?
    ORDER BY rh.renamed_at DESC
  `).all(req.user.id)

  res.json(history)
})

module.exports = router 
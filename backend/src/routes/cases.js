const express = require('express')
const router  = express.Router()
const db      = require('../db/schema')
const { authMiddleware } = require('../middleware/auth')

// Case records contain claimant PHI (names, date of loss, notes), so every
// endpoint requires a valid session token. The frontend api client attaches the
// bearer token automatically on all requests.
router.use(authMiddleware)

// GET /api/cases — all cases, newest first.
router.get('/', (req, res) => {
  try {
    const cases = db.prepare('SELECT * FROM cases ORDER BY added_on DESC').all()
    res.json(cases)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/cases — creates a single case; rejects duplicate case numbers.
router.post('/', (req, res) => {
  const c = req.body
  if (!c.num) return res.status(400).json({ error: 'num is required' })

  // Check duplicate
  const exists = db.prepare('SELECT id FROM cases WHERE num = ?').get(c.num)
  if (exists) return res.status(409).json({ error: 'Duplicate case number' })

  try {
    const stmt = db.prepare(`
      INSERT INTO cases
        (num, created, last, first, rb, dol, open,
         c15, c21, c99, c99b,
         migrated, fu, taskflow, phase,
         qd, qddue, gsd, gscdue, routed,
         urb, notes, bv, bvdue, completed,
         added_on, source)
      VALUES
        (@num, @created, @last, @first, @rb, @dol, @open,
         @c15, @c21, @c99, @c99b,
         @migrated, @fu, @taskflow, @phase,
         @qd, @qddue, @gsd, @gscdue, @routed,
         @urb, @notes, @bv, @bvdue, @completed,
         @added_on, @source)
    `)
    const info = stmt.run({
      num:      c.num      || null,
      created:  c.created  || null,
      last:     c.last     || null,
      first:    c.first    || null,
      rb:       c.rb       || null,
      dol:      c.dol      || null,
      open:     c.open     || null,
      c15:      c.c15      || null,
      c21:      c.c21      || null,
      c99:      c.c99      || null,
      c99b:     c.c99b     || null,
      migrated: c.migrated || null,
      fu:       c.fu       || null,
      taskflow: c.taskflow || null,
      phase:    c.phase    || null,
      qd:       c.qd       || null,
      qddue:    c.qddue    || null,
      gsd:      c.gsd      || null,
      gscdue:   c.gscdue   || null,
      routed:   c.routed   || null,
      urb:      c.urb      || null,
      notes:    c.notes    || null,
      bv:       c.bv       || null,
      bvdue:    c.bvdue    || null,
      completed:c.completed|| null,
      added_on: c.addedOn  || new Date().toISOString(),
      source:   c.source   || 'manual',
    })
    const saved = db.prepare('SELECT * FROM cases WHERE id = ?').get(info.lastInsertRowid)
    res.status(201).json(saved)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/cases/:num — deletes by case number (the human-readable identifier).
router.delete('/:num', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM cases WHERE num = ?').run(req.params.num)
    if (info.changes === 0) return res.status(404).json({ error: 'Case not found' })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/cases/import — bulk-inserts an array of cases inside a transaction.
// Uses INSERT OR IGNORE so re-importing the same export is safe.
router.post('/import', (req, res) => {
  const rows = req.body
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Expected array' })

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO cases
      (num, created, last, first, rb, dol, open,
       c15, c21, c99, c99b,
       migrated, fu, taskflow, phase,
       qd, qddue, gsd, gscdue, routed,
       urb, notes, bv, bvdue, completed,
       added_on, source)
    VALUES
      (@num, @created, @last, @first, @rb, @dol, @open,
       @c15, @c21, @c99, @c99b,
       @migrated, @fu, @taskflow, @phase,
       @qd, @qddue, @gsd, @gscdue, @routed,
       @urb, @notes, @bv, @bvdue, @completed,
       @added_on, @source)
  `)

  const importMany = db.transaction((cases) => {
    let inserted = 0
    let skipped  = 0
    for (const c of cases) {
      const info = insertStmt.run({
        num:      c.num      || null,
        created:  c.created  || null,
        last:     c.last     || null,
        first:    c.first    || null,
        rb:       c.rb       || null,
        dol:      c.dol      || null,
        open:     c.open     || null,
        c15:      c.c15      || null,
        c21:      c.c21      || null,
        c99:      c.c99      || null,
        c99b:     c.c99b     || null,
        migrated: c.migrated || null,
        fu:       c.fu       || null,
        taskflow: c.taskflow || null,
        phase:    c.phase    || null,
        qd:       c.qd       || null,
        qddue:    c.qddue    || null,
        gsd:      c.gsd      || null,
        gscdue:   c.gscdue   || null,
        routed:   c.routed   || null,
        urb:      c.urb      || null,
        notes:    c.notes    || null,
        bv:       c.bv       || null,
        bvdue:    c.bvdue    || null,
        completed:c.completed|| null,
        added_on: c.addedOn  || new Date().toISOString(),
        source:   'import',
      })
      if (info.changes > 0) inserted++
      else skipped++
    }
    return { inserted, skipped }
  })

  try {
    const result = importMany(rows)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

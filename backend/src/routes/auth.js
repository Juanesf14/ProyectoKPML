const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { v4: uuidv4 } = require('uuid')
const db = require('../db/schema')

const router = express.Router()

// POST /api/auth/register — creates a new user with role 'user'.
// New accounts are always assigned the base role; admins must be seeded via .env.
router.post('/register', (req, res) => {
  const { name, email, password } = req.body

  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields are required' })

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists)
    return res.status(400).json({ error: 'Email already registered' })

  const password_hash = bcrypt.hashSync(password, 10)
  const id = uuidv4()

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'user')
  `).run(id, name, email, password_hash)

  const token = jwt.sign({ id, name, email, role: 'user' }, process.env.JWT_SECRET, { expiresIn: '8h' })

  res.status(201).json({ token, user: { id, name, email, role: 'user' } })
})

// POST /api/auth/login — returns a signed JWT valid for 8 hours.
// Both "user not found" and "wrong password" return the same 401 to avoid user enumeration.
router.post('/login', (req, res) => {
  const { email, password } = req.body

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' })

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user)
    return res.status(401).json({ error: 'Invalid credentials' })

  const valid = bcrypt.compareSync(password, user.password_hash)
  if (!valid)
    return res.status(401).json({ error: 'Invalid credentials' })

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  )

  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
})

module.exports = router
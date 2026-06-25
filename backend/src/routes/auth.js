const express = require('express')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const rateLimit = require('express-rate-limit')
const { v4: uuidv4 } = require('uuid')
const { authMiddleware, adminMiddleware } = require('../middleware/auth')
const db = require('../db/schema')

const router = express.Router()

// Throttle credential-guessing on the unauthenticated endpoints. Allows normal
// retries (a few typos) but blocks brute-force attempts.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
})

const signToken = (u) =>
  jwt.sign(
    { id: u.id, name: u.name, email: u.email, role: u.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  )

const userCount = () => db.prepare('SELECT COUNT(*) AS c FROM users').get().c

// GET /api/auth/status — public. Tells the login screen whether this is a fresh
// install with no users yet, so it can offer first-admin bootstrap instead of login.
router.get('/status', (req, res) => {
  res.json({ needsBootstrap: userCount() === 0 })
})

// POST /api/auth/bootstrap — public, but ONLY works while the users table is empty.
// Creates the first account as an admin. This is how a new install (e.g. a VDI)
// gets its initial administrator without seeding the DB by hand.
router.post('/bootstrap', (req, res) => {
  if (userCount() > 0)
    return res.status(403).json({ error: 'Setup already completed' })

  const { name, email, password } = req.body
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields are required' })
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' })

  const password_hash = bcrypt.hashSync(password, 10)
  const id = uuidv4()
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'admin')
  `).run(id, name, email, password_hash)

  const user = { id, name, email, role: 'admin' }
  res.status(201).json({ token: signToken(user), user })
})

// POST /api/auth/login — returns a signed JWT valid for 8 hours.
// Both "user not found" and "wrong password" return the same 401 to avoid user enumeration.
router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body

  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required' })

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user)
    return res.status(401).json({ error: 'Invalid credentials' })

  const valid = bcrypt.compareSync(password, user.password_hash)
  if (!valid)
    return res.status(401).json({ error: 'Invalid credentials' })

  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } })
})

// POST /api/auth/change-password — any signed-in user changes their OWN password
// by proving they know the current one. Covers the common self-service case.
router.post('/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Current and new password are required' })
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' })

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect' })

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), user.id)
  res.json({ ok: true })
})

// ── Admin-only user management ───────────────────────────────────────────────

// POST /api/auth/register — admin creates a new account (role 'user' or 'admin').
// No longer public: self-registration is disabled so only admins provision users.
router.post('/register', authMiddleware, adminMiddleware, (req, res) => {
  const { name, email, password, role } = req.body
  if (!name || !email || !password)
    return res.status(400).json({ error: 'All fields are required' })
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' })

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (exists)
    return res.status(400).json({ error: 'Email already registered' })

  const newRole = role === 'admin' ? 'admin' : 'user'
  const id = uuidv4()
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, email, bcrypt.hashSync(password, 10), newRole)

  res.status(201).json({ user: { id, name, email, role: newRole } })
})

// GET /api/auth/users — admin lists all accounts (no password hashes).
router.get('/users', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY created_at').all()
  res.json(rows)
})

// POST /api/auth/reset-password — admin resets another user's password.
// This is the password-recovery path for a local install (no email server).
router.post('/reset-password', authMiddleware, adminMiddleware, (req, res) => {
  const { userId, newPassword } = req.body
  if (!userId || !newPassword)
    return res.status(400).json({ error: 'userId and newPassword are required' })
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' })

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
  if (!target)
    return res.status(404).json({ error: 'User not found' })

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), userId)
  res.json({ ok: true })
})

// DELETE /api/auth/users/:id — admin removes an account. Cannot delete yourself,
// and cannot remove the last remaining admin (avoids locking everyone out).
router.delete('/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params
  if (id === req.user.id)
    return res.status(400).json({ error: 'You cannot delete your own account' })

  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id)
  if (!target)
    return res.status(404).json({ error: 'User not found' })

  if (target.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c
    if (admins <= 1)
      return res.status(400).json({ error: 'Cannot delete the last administrator' })
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.json({ ok: true })
})

module.exports = router

const jwt = require('jsonwebtoken')

/**
 * Validates the Bearer token in the Authorization header.
 * Attaches the decoded JWT payload to req.user on success.
 */
const authMiddleware = (req, res, next) => {
  const header = req.headers['authorization']
  if (!header) return res.status(401).json({ error: 'Token required' })

  const token = header.split(' ')[1]
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * Blocks non-admin users. Must be chained after authMiddleware so req.user is set.
 */
const adminMiddleware = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' })
  next()
}

module.exports = { authMiddleware, adminMiddleware }
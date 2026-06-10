const express = require('express')
const { authMiddleware } = require('../middleware/auth')
const { chatWithDocument } = require('../services/aiChat')

const router = express.Router()

router.use(authMiddleware)

/**
 * POST /api/chat
 *
 * Sends a conversation turn to Gemini using the document text stored in the
 * server-side session created by /api/analyze.
 *
 * Body: { sessionId: string, messages: Array<{ role, content }> }
 * Sessions expire after 30 minutes of inactivity (see aiChat.js).
 */
router.post('/', async (req, res) => {
  const { sessionId, messages } = req.body

  if (!sessionId || !Array.isArray(messages) || messages.length === 0)
    return res.status(400).json({ error: 'sessionId and messages are required' })

  if (!process.env.GEMINI_API_KEY)
    return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on the server' })

  try {
    const reply = await chatWithDocument(sessionId, messages)
    res.json({ reply })
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED')
      return res.status(404).json({ error: 'Session expired. Reload the document to restart the chat.' })
    console.error('Chat error:', err?.message, err?.status, JSON.stringify(err?.errorDetails ?? ''))
    res.status(500).json({ error: 'Failed to process question' })
  }
})

module.exports = router

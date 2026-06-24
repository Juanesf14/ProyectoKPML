const { GoogleGenerativeAI } = require('@google/generative-ai')

// Document text is stored in memory keyed by sessionId rather than re-sent
// on every chat turn. TTL is sliding: each message resets the expiry clock.
const sessions = new Map()
const SESSION_TTL = 30 * 60 * 1000 // 30 minutes

/** Stores extracted document text for a new chat session. */
const storeSession = (sessionId, text) => {
  sessions.set(sessionId, { text, expiresAt: Date.now() + SESSION_TTL })
}

/** Returns the session and resets its TTL, or null if it has expired. */
const getSession = (sessionId) => {
  const session = sessions.get(sessionId)
  if (!session) return null
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId)
    return null
  }
  session.expiresAt = Date.now() + SESSION_TTL
  return session
}

// Periodic GC so memory doesn't grow unbounded in long-running server instances.
// .unref() prevents this timer from keeping the process alive when all windows close.
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(id)
  }
}, 10 * 60 * 1000).unref()

/**
 * Sends a chat turn to Gemini with the document as system context.
 * Only the last 10 messages are forwarded to stay within the context budget.
 *
 * Throws 'SESSION_EXPIRED' if the session is not found or has timed out.
 *
 * Note: Gemini uses role 'model' where the OpenAI convention uses 'assistant',
 * and passes content as parts[] arrays instead of plain strings.
 *
 * ── PRIVACY / PII ────────────────────────────────────────────────────────────
 * This function sends the document text (which may contain PII/PHI) and the
 * user's questions to Google Gemini, a third-party service. The UI shows an
 * explicit privacy notice (see ChatPanel.jsx) before any message is sent.
 *
 * ── PLANNED MIGRATION ────────────────────────────────────────────────────────
 * The intended long-term provider for this chat is **Lois (Filevine's AI)**,
 * which keeps data within the firm's case-management platform and avoids sending
 * PHI to Google. When that integration is available, replace the Gemini call
 * below with the Lois API while keeping this same interface
 * (chatWithDocument(sessionId, messages) -> reply string).
 */
const chatWithDocument = async (sessionId, messages) => {
  const session = getSession(sessionId)
  if (!session) throw new Error('SESSION_EXPIRED')

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({
    model: 'gemini-flash-lite-latest',
    systemInstruction: `You are a helpful assistant specializing in medical and insurance documents for a legal case management firm. You have access to the following medical document. Answer questions about it accurately and concisely. If the answer is not in the document, say so clearly. Respond in the same language the user writes in.

DOCUMENT:
${session.text}`,
  })

  const recent      = messages.slice(-10)
  const history     = recent.slice(0, -1).map(m => ({
    role:  m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const lastMessage = recent[recent.length - 1]

  const chat   = model.startChat({ history })
  const result = await chat.sendMessage(lastMessage.content)
  return result.response.text()
}

module.exports = { storeSession, chatWithDocument }

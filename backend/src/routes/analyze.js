const express = require('express')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const { authMiddleware } = require('../middleware/auth')
const { analyzeDocument, prepareTextForAI } = require('../services/docAnalyzer')
const { analyzeWithAI } = require('../services/aiAnalyzer')
const { storeSession } = require('../services/aiChat')
const db = require('../db/schema')

const router = express.Router()

router.use(authMiddleware)

/**
 * Minimum local-analysis confidence below which Gemini is invoked.
 * The caller must also pass allowAI=true (explicit user consent per session).
 */
const GEMINI_THRESHOLD = 0.35

/**
 * POST /api/analyze
 *
 * Pipeline:
 *  1. Extract text from the file (PDF text layer, OCR fallback, or direct image OCR).
 *  2. Run regex + fuzzy matching against the provider list.
 *  3. If local confidence < GEMINI_THRESHOLD AND the caller passed allowAI=true,
 *     escalate to Gemini for a second opinion.
 *  4. If local confidence < GEMINI_THRESHOLD AND allowAI=false (default), return
 *     needsAI=true so the UI can ask for consent before a second call.
 *  5. Store extracted text in a server-side session so the chat endpoint
 *     can answer follow-up questions without re-uploading the file.
 *
 * Body params:
 *   filePath  {string}  Absolute OS path to the document.
 *   allowAI   {boolean} Whether the user has consented to Gemini for this call.
 *                       Defaults to false — the UI must explicitly opt in.
 *
 * Returns: suggestion, dates, flags, sessionId, needsAI?
 *          (extractedText is stripped — it lives server-side in the session).
 */
router.post('/', async (req, res) => {
  const { filePath, allowAI = false } = req.body
  if (!filePath) return res.status(400).json({ error: 'filePath is required' })

  // Reject relative paths — the renderer must always send an absolute OS path.
  if (!path.isAbsolute(filePath))
    return res.status(400).json({ error: 'Invalid file path' })

  const providers = db.prepare('SELECT id, name FROM providers').all()

  // Always create a chat session even when no providers exist,
  // so the user can still ask questions about the document.
  const result = await analyzeDocument(filePath, providers)
  const sessionId = uuidv4()
  storeSession(sessionId, result.extractedText || '')

  if (providers.length === 0) {
    return res.json({ suggestion: null, reason: 'No providers registered', sessionId })
  }

  const lowConfidence = !result.suggestion || result.suggestion.confidence < GEMINI_THRESHOLD

  // Also offer AI when the provider was matched locally but critical dates are
  // missing — Gemini is significantly better at extracting dates from unusual
  // formats (handwritten, non-standard labels, etc.) than the local regex.
  const missingKeyDates = !result.dates?.dosStart
  const needsAI = lowConfidence || missingKeyDates

  // If AI is needed but consent hasn't been granted, return the local result
  // with needsAI=true so the frontend can show the consent modal first.
  if (needsAI && !allowAI) {
    const { extractedText: _, ...localData } = result
    return res.json({ ...localData, sessionId, needsAI: true })
  }

  // Escalate to Gemini when AI is needed AND the user has consented.
  if (needsAI && allowAI && process.env.GEMINI_API_KEY && result.extractedText) {
    try {
      const cleanText = prepareTextForAI(result.extractedText)
      const aiResult = await analyzeWithAI(cleanText, providers)

      if (aiResult) {
        // Override the regex provider match only if AI is more confident.
        if (aiResult.provider_id && aiResult.confidence > (result.suggestion?.confidence || 0)) {
          result.suggestion = {
            provider_id: aiResult.provider_id,
            name: aiResult.provider_name,
            confidence: aiResult.confidence,
            method: 'ai',
          }
        }

        // Backfill dates that the regex failed to capture.
        if (!result.dates) result.dates = {}
        if (!result.dates.dosStart   && aiResult.dosStart)   result.dates.dosStart   = aiResult.dosStart
        if (!result.dates.dosEnd     && aiResult.dosEnd)     result.dates.dosEnd     = aiResult.dosEnd
        if (!result.dates.updateDate && aiResult.updateDate) result.dates.updateDate = aiResult.updateDate

        // Backfill flags that the regex patterns didn't catch.
        if (!result.flags) result.flags = {}
        if (!result.flags.hasAmbulance && aiResult.hasAmbulance) {
          result.flags.hasAmbulance     = aiResult.hasAmbulance
          result.flags.ambulanceCompany = aiResult.ambulanceCompany
        }
        if (!result.flags.hasReferral && aiResult.hasReferral) {
          result.flags.hasReferral = aiResult.hasReferral
          result.flags.referrals   = aiResult.referrals || []
        }
      }
    } catch (err) {
      console.error('Gemini escalation error:', err.message)
    }
  }

  // Strip extractedText from the response — it lives server-side in the session.
  const { extractedText: _, ...responseData } = result
  res.json({ ...responseData, sessionId })
})

module.exports = router

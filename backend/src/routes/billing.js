const express  = require('express')
const path     = require('path')
const { v4: uuidv4 } = require('uuid')
const { authMiddleware }      = require('../middleware/auth')
const { analyzeBillingDocument } = require('../services/billingParser')
const { analyzeBillingWithAI }   = require('../services/billingAI')
const db = require('../db/schema')

const router = express.Router()
router.use(authMiddleware)

// Confidence below this threshold triggers the AI banner
const AI_THRESHOLD = 0.60

/**
 * POST /api/billing/analyze
 *
 * 1. Extract text from file (pdf-parse → OCR fallback)
 * 2. Run Athena regex parser + confidence scoring
 * 3. If confidence < 0.60 AND allowAI=false → return needsAI=true (banner)
 * 4. If confidence < 0.60 AND allowAI=true  → escalate to Gemini
 */
router.post('/analyze', async (req, res) => {
  const { filePath, allowAI = false } = req.body
  if (!filePath)                  return res.status(400).json({ error: 'filePath is required' })
  if (!path.isAbsolute(filePath)) return res.status(400).json({ error: 'Invalid file path' })

  const result = await analyzeBillingDocument(filePath)
  const { extractedText, ...responseData } = result

  // Send a debug snippet (first 4000 chars) so the frontend can show the raw extracted text.
  // Full text is kept in memory only for AI escalation.
  const debugText = (extractedText || '').slice(0, 4000)

  const needsAI = result.confidence < AI_THRESHOLD

  if (needsAI && !allowAI) {
    return res.json({ ...responseData, needsAI: true, debugText })
  }

  if (needsAI && allowAI && process.env.GEMINI_API_KEY && extractedText) {
    try {
      const aiResult = await analyzeBillingWithAI(extractedText)
      if (aiResult) {
        return res.json({
          ...responseData,
          claims:     aiResult.claims  || responseData.claims,
          totals:     aiResult.totals  || responseData.totals,
          confidence: 1.0,
          issues:     [],
          source:     'ai',
          needsAI:    false,
          debugText,
        })
      }
    } catch (err) {
      console.error('Billing AI escalation error:', err.message)
    }
  }

  return res.json({ ...responseData, needsAI: false, debugText })
})

/**
 * POST /api/billing/save
 * Persists the final (possibly user-edited) billing summary to billing_summaries.
 */
router.post('/save', (req, res) => {
  const { case_num, provider_id, file_path, totals, confidence, source } = req.body
  if (!totals) return res.status(400).json({ error: 'totals is required' })

  try {
    const id = uuidv4()
    db.prepare(`
      INSERT INTO billing_summaries
        (id, case_num, provider_id, file_path,
         total_charges, total_adjustments, pip_paid, health_ins_paid,
         patient_paid, outstanding, confidence, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      case_num    || null,
      provider_id || null,
      file_path   || null,
      totals.totalCharges     ?? 0,
      totals.totalAdjustments ?? 0,
      totals.pipPaid          ?? 0,
      totals.healthPaid       ?? 0,
      totals.patientPaid      ?? 0,
      totals.outstanding      ?? 0,
      confidence ?? 0,
      source     || 'local',
      req.user?.id || null
    )
    res.json({ id })
  } catch (err) {
    console.error('Billing save error:', err.message)
    res.status(500).json({ error: 'Failed to save billing summary' })
  }
})

/**
 * GET /api/billing/:caseNum
 * Returns the most recent billing summary for a case.
 */
router.get('/:caseNum', (req, res) => {
  const row = db.prepare(`
    SELECT * FROM billing_summaries
    WHERE case_num = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(req.params.caseNum)
  res.json(row || null)
})

module.exports = router

const fs   = require('fs')
const path = require('path')
const pdfParse = require('pdf-parse')
const { ocrExtract, ocrExtractImage, ocrExtractMultiPages } = require('./ocr')

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'])
const OCR_THRESHOLD = 50

// ── ML-NER model (lazy-loaded, optional) ─────────────────────────────────────
// Model lives in ml/models/infer.js; gracefully absent if not yet exported.

const ML_CONFIDENCE_THRESHOLD = 0.65  // Try ML when regex confidence falls below this

let _mlExtract = null
const getMlExtract = () => {
  if (_mlExtract === null) {
    try {
      const inferPath = path.resolve(__dirname, '../../../ml/models/infer.js')
      _mlExtract = fs.existsSync(inferPath) ? require(inferPath).extractBillingFields : false
    } catch {
      _mlExtract = false
    }
  }
  return _mlExtract || null
}

const tryMlExtraction = async (text) => {
  const extract = getMlExtract()
  if (!extract) return null

  try {
    const ml = await extract(text)
    // Require CHARGE + at least 2 other fields to trust the result
    if (!ml.fieldsFound.includes('CHARGE') || ml.fieldsFound.length < 3) return null

    const outstanding = ml.outstanding > 0
      ? ml.outstanding
      : Math.max(0, +(ml.totalCharge - ml.adjustments - ml.pipPaid - ml.healthPaid - ml.patientPaid).toFixed(2))

    const totals = {
      totalCharges:     ml.totalCharge,
      totalAdjustments: ml.adjustments,
      pipPaid:          ml.pipPaid,
      healthPaid:       ml.healthPaid,
      patientPaid:      ml.patientPaid,
      outstanding,
    }

    return {
      claims: [{
        claimId:     'ML',
        charge:       ml.totalCharge,
        adjustments:  ml.adjustments,
        patientPaid:  ml.patientPaid,
        healthPaid:   ml.healthPaid,
        pipPaid:      ml.pipPaid,
        payments: [
          ...(ml.pipPaid     > 0 ? [{ source: 'pip',     planName: 'PIP',       amount: ml.pipPaid     }] : []),
          ...(ml.healthPaid  > 0 ? [{ source: 'health',  planName: 'Insurance', amount: ml.healthPaid  }] : []),
          ...(ml.patientPaid > 0 ? [{ source: 'patient', planName: 'Patient',   amount: ml.patientPaid }] : []),
        ],
        outstanding,
        _hasCharge:   true,
        _hasBadAmount: false,
      }],
      totals,
      confidence: Math.min(0.85, 0.60 + ml.fieldsFound.length * 0.05),
      issues:     [`ML-NER extraído: ${ml.fieldsFound.join(', ')}`],
      parserUsed: 'ml-ner',
    }
  } catch {
    return null
  }
}

const extractText = async (filePath) => {
  try {
    const buffer = fs.readFileSync(filePath)
    const data = await pdfParse(buffer)
    return data.text || ''
  } catch {
    // Malformed PDF (bad XRef, encrypted, etc.) — fall through to OCR
    return ''
  }
}

// Find all dollar amounts in a text fragment
const findAmounts = (str) => {
  const amounts = []
  const re = /\$\s*(-?[\d,]+\.\d{2})/g
  let m
  while ((m = re.exec(str)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''))
    if (!isNaN(val)) amounts.push(val)
  }
  return amounts
}

// Classify payment source from the transaction line
const classifySource = (line) => {
  if (/\bPATIENT\b/i.test(line)) return 'patient'
  if (/\bPIP\b|PERSONAL\s+INJURY\s+PROT/i.test(line)) return 'pip'
  return 'health'
}

// Extract a readable plan name from a payment or adjustment line
const extractPlanName = (line) => {
  const m = line.match(/(?:PAYMENT\s+\S+|ADJUSTMENT\s+\S+)\s+(.*?)(?=\s+[A-Z]{2,6}\s*$|\s*\$|\s{3,})/i)
  if (m && m[1]) return m[1].replace(/\d+\s*$/, '').trim().slice(0, 60)
  return null
}

// Fallback parser for pre-formatted billing summary tables.
// Handles rows like: "253788 $270.00 $147.93 $30.00 $92.07"
// Column order assumed: Charge, Adjustments, Patient, Health (matches Athena billing summaries)
const parseSummaryTable = (text) => {
  const claims = []
  // Match lines: 5-6 digit claim ID followed by 2+ dollar amounts
  const rowRe  = /^(\d{5,6})((?:\s+\$[\d,]+\.\d{2}){2,})/gm
  const amtRe  = /\$([\d,]+\.\d{2})/g

  let m
  while ((m = rowRe.exec(text)) !== null) {
    const claimId = m[1]
    const amounts = []
    let am
    amtRe.lastIndex = 0
    while ((am = amtRe.exec(m[2])) !== null) {
      amounts.push(parseFloat(am[1].replace(/,/g, '')) || 0)
    }
    if (amounts.length < 2) continue

    const charge      = amounts[0] || 0
    const adjustments = amounts[1] || 0
    const patientPaid = amounts[2] || 0
    const healthPaid  = amounts[3] || 0

    claims.push({
      claimId,
      charge,
      adjustments,
      patientPaid,
      healthPaid,
      pipPaid:      0,
      payments:     [
        ...(patientPaid > 0 ? [{ source: 'patient', planName: 'Patient',   amount: patientPaid }] : []),
        ...(healthPaid  > 0 ? [{ source: 'health',  planName: 'Insurance', amount: healthPaid  }] : []),
      ],
      outstanding:   null,
      _hasCharge:    charge > 0,
      _hasBadAmount: false,
    })
  }

  return claims
}

// Third fallback: CPT / HCPCS line-item bills (itemized vertical format).
// Detects procedure codes alone on a line followed by concatenated dollar amounts:
//   "99214\n...description...\n$150.00$120.00$30.00"
// Column order assumed: Total Charge | Ins. Allowed | Patient Share
const parseCptLineItems = (text) => {
  const lines   = text.split('\n').map(l => l.trim()).filter(l => l)
  const claims  = []
  const cptRe   = /^([A-Z]?\d{4,5})$/           // CPT or HCPCS code alone on its line
  const hasAmts = (l) => /\$[\d,]+\.\d{2}/.test(l)

  let i = 0
  while (i < lines.length) {
    const cptMatch = lines[i].match(cptRe)
    if (!cptMatch) { i++; continue }

    const cptCode = cptMatch[1]
    let j = i + 1

    // Skip description lines; stop at amounts line or next CPT code
    while (j < lines.length && !hasAmts(lines[j]) && !lines[j].match(cptRe)) j++

    if (j < lines.length && hasAmts(lines[j])) {
      const amounts = findAmounts(lines[j])
      if (amounts.length >= 1) {
        const charge       = amounts[0] || 0
        // 3-col: Charge | Ins.Allowed | Patient   2-col: Charge | Patient
        const insAllowed   = amounts.length >= 3 ? amounts[1] : 0
        const patientShare = amounts.length >= 3 ? amounts[2] : (amounts[1] || 0)
        const adjustment   = insAllowed > 0 ? Math.max(0, +(charge - insAllowed).toFixed(2)) : 0
        const healthPaid   = Math.max(0, +(insAllowed - patientShare).toFixed(2))

        claims.push({
          claimId: cptCode,
          charge,
          adjustments: adjustment,
          patientPaid: patientShare,
          healthPaid,
          pipPaid: 0,
          payments: [
            ...(healthPaid   > 0 ? [{ source: 'health',  planName: 'Insurance', amount: healthPaid   }] : []),
            ...(patientShare > 0 ? [{ source: 'patient', planName: 'Patient',   amount: patientShare }] : []),
          ],
          outstanding: null,
          _hasCharge: charge > 0,
          _hasBadAmount: false,
        })
      }
      i = j + 1
    } else {
      i++
    }
  }

  if (!claims.length) return []

  // Confidence: verify sum of charges against document grand total
  const totalMatch = text.match(/(?:total\s+gross\s+charges?|total\s+charges?|grand\s+total)[:\s\$]*\$?\s*([\d,]+\.\d{2})/i)
  const docTotal   = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : null
  const sumCharges = +claims.reduce((s, c) => s + c.charge, 0).toFixed(2)

  const issues     = []
  let confidence   = 0.90

  if (docTotal !== null && Math.abs(sumCharges - docTotal) > 1.00) {
    confidence -= 0.20
    issues.push(`Line items total $${sumCharges.toFixed(2)} ≠ document total $${docTotal.toFixed(2)}`)
  }
  // PIP not shown per-line — always flag for manual review in PI cases
  issues.push('PIP breakdown not available per line — verify if PIP applies')
  confidence -= 0.05

  return claims.map((c, idx) => ({
    ...c,
    ...(idx === 0 ? { _confidence: Math.max(0, confidence), _issues: issues } : {}),
  }))
}

// Fourth fallback: hospital / UB-04 style bills with grand-total summary lines.
// Handles multi-line formats like "Insurance Paid Amount:\n-\n$1,217.00"
const parseHospitalBill = (text) => {
  // Normalize common multi-line patterns before matching
  const norm = text
    .replace(/:\s*\n\s*-\s*\n\s*\$/g, ': $')       // "Label:\n-\n$X" → "Label: $X"
    .replace(/\(([A-Za-z\s]+)\n\s*([A-Za-z]+)\)/g, '($1 $2)')  // "(Patient\nResponsibility)" → one line
    .replace(/\n\s*Responsibility\)/gi, ' Responsibility)')

  const money = (pattern) => {
    const m = norm.match(pattern)
    return m ? parseFloat(m[1].replace(/,/g, '')) : 0
  }

  const charge = money(/(?:total\s+(?:gross\s+)?charges?|total\s+billed|gross\s+charges?|amount\s+billed)[:\s\$]+\$?\s*([\d,]+\.\d{2})/i)
  if (!charge) return []

  // Adjustments — covers: "Contractual Adjustment", "Insurance Adjustment", "Network Adjustment",
  //   "Balance Adjustment", "Discount", "Write-off", "-$X" after adjustment keywords
  const adjRaw = money(/(?:(?:contractual|insurance|network|balance|provider)[\s\w]*adj(?:ustment)?s?|discount|write.?off)[\s:\-\$]+\$?\s*([\d,]+\.\d{2})/i)
  // PIP / auto insurance
  const pipRaw = money(/(?:\bpip\b|personal\s+injury\s+prot(?:ection)?|auto\s+ins(?:urance)?)[\s:\$]+\$?\s*([\d,]+\.\d{2})/i)
  // Insurance paid — flexible separator (handles multi-line "Insurance Paid Amount:\n-\n$X")
  const insRaw = money(/(?:insurance\s+paid|ins\.?\s+paid\s+amount|insurance\s+pay(?:ment)?|plan\s+paid|third.?party\s+pay(?:ment)?)s?[\s\S]{0,25}\$([\d,]+\.\d{2})/i)
  // Patient PAID — only explicit past-tense labels (copay, cash, patient payment).
  // "Patient Balance Due" / "Total Due" / "Patient Responsibility" mean the patient OWES that
  // amount (the lien in PI cases) — they are NOT payments and must NOT be subtracted here.
  const patientPaidRaw = money(/(?:patient\s+(?:paid|payment|cash)|self.?pay\s+(?:paid|payment)|(?:patient\s+)?copay(?:\s+paid)?)[\s:\$]+\$?\s*([\d,]+\.\d{2})/i)

  // "Balance Due" / "Patient Balance Due" — cross-check: this should equal the outstanding
  // computed below. Used only for confidence validation, not subtracted from charges.
  const balanceDueRaw = money(/(?:patient\s+balance(?:\s+due)?|total\s+(?:amount\s+)?due|amount\s+(?:due|owed)|balance\s+due|total\s+patient\s+responsibility)[\s\S]{0,30}\$([\d,]+\.\d{2})/i)

  const pipPaid     = pipRaw
  const healthPaid  = Math.max(0, insRaw - pipPaid)
  const patientPaid = patientPaidRaw
  const adjustments = adjRaw

  // Account / claim ID — flexible separator (handles "Account Number SMC-458921" without colon)
  const acctMatch = norm.match(
    /(?:account[\s:]*(?:number|#|no\.?)|(?:statement|invoice|bill|claim)[\s]+(?:no\.?|number|#))[\s:]+([A-Z0-9\-]+)/i
  )
  const claimId = acctMatch ? acctMatch[1].trim() : 'ACCT'

  const issues     = []
  let confidence   = 0.85

  if (pipPaid === 0 && insRaw > 0)
    issues.push('PIP not distinguished from health insurance — verify breakdown manually')

  if (patientPaid === 0 && insRaw === 0 && balanceDueRaw === 0) {
    issues.push('No payment amounts found in document')
    confidence -= 0.20
  }

  if (pipPaid === 0 && insRaw > 0) confidence -= 0.10

  const outstanding = +(charge - adjustments - pipPaid - healthPaid - patientPaid).toFixed(2)

  // Cross-check: if document states a balance due, it should match our calculated outstanding
  if (balanceDueRaw > 0 && Math.abs(outstanding - balanceDueRaw) > 1.00) {
    issues.push(`Calculated outstanding $${outstanding.toFixed(2)} ≠ document balance due $${balanceDueRaw.toFixed(2)}`)
    confidence -= 0.15
  }

  return [{
    claimId,
    charge,
    adjustments,
    patientPaid,
    healthPaid,
    pipPaid,
    payments: [
      ...(pipPaid    > 0 ? [{ source: 'pip',     planName: 'PIP',       amount: pipPaid    }] : []),
      ...(healthPaid > 0 ? [{ source: 'health',  planName: 'Insurance', amount: healthPaid }] : []),
      ...(patientPaid > 0 ? [{ source: 'patient', planName: 'Patient',  amount: patientPaid }] : []),
    ],
    outstanding,
    _hasCharge:    true,
    _hasBadAmount: false,
    _confidence:   Math.max(0, confidence),
    _issues:       issues,
  }]
}

const parseBilling = (text) => {
  const claims = []

  // Each Athena claim block starts with "Claim ID XXXXX"
  const claimRe = /\bClaim\s+ID\s+(\d+)/gi
  const claimMatches = [...text.matchAll(claimRe)]

  if (claimMatches.length === 0) {
    // Fallback 1: summary table format (Athena billing summary PDFs)
    const summaryClaims = parseSummaryTable(text)
    if (summaryClaims.length > 0) {
      const totals = aggregateTotals(summaryClaims)
      return { claims: summaryClaims, totals, confidence: 0.90, issues: [], parserUsed: 'summary-table' }
    }

    // Fallback 2: CPT / HCPCS line items (itemized vertical format)
    const cptClaims = parseCptLineItems(text)
    if (cptClaims.length > 0) {
      const totals = aggregateTotals(cptClaims)
      const conf   = cptClaims[0]._confidence ?? 0.85
      const issues = cptClaims[0]._issues     ?? []
      return { claims: cptClaims, totals, confidence: conf, issues, parserUsed: 'cpt-lines' }
    }

    // Fallback 3: hospital / UB-04 grand-total summary
    const hospitalClaims = parseHospitalBill(text)
    if (hospitalClaims.length > 0) {
      const totals = aggregateTotals(hospitalClaims)
      const conf   = hospitalClaims[0]._confidence ?? 0.75
      const issues = hospitalClaims[0]._issues     ?? []
      return { claims: hospitalClaims, totals, confidence: conf, issues, parserUsed: 'hospital-totals' }
    }

    return {
      claims: [],
      totals: buildZeroTotals(),
      confidence: 0,
      issues: ['No claims detected in document'],
      parserUsed: 'none',
    }
  }

  for (let i = 0; i < claimMatches.length; i++) {
    const claimId = claimMatches[i][1]
    const blockStart = claimMatches[i].index + claimMatches[i][0].length
    const blockEnd   = claimMatches[i + 1]?.index ?? text.length
    const block      = text.slice(blockStart, blockEnd)

    const claim = {
      claimId,
      charge: 0,
      adjustments: 0,
      // payments: [{ source: 'pip'|'health'|'patient', planName, amount }]
      payments: [],
      outstanding: null,
      _hasCharge:   false,
      _hasBadAmount: false,
    }

    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 3)

    for (const line of lines) {
      // TRANSFERIN = internal balance move, not a real payment — always skip
      if (/\bTRANSFERIN\b/i.test(line)) continue

      // OUTSTANDING = end-of-claim balance (may repeat per sub-procedure)
      if (/\bOUTSTANDING\b/i.test(line) && !/Claim\s+ID/i.test(line)) {
        const amounts = findAmounts(line)
        if (amounts.length) claim.outstanding = amounts[amounts.length - 1]
        continue
      }

      const amounts = findAmounts(line)

      // Flag OCR artifacts: "$" followed by non-digit non-dash
      if (/\$[^\d\s\-,]/.test(line)) claim._hasBadAmount = true

      if (/\bCHARGE\b/i.test(line) && !/OUTSTANDING/i.test(line)) {
        const pos = amounts.find(a => a > 0)
        if (pos !== undefined) {
          claim.charge = +(claim.charge + pos).toFixed(2)
          claim._hasCharge = true
        } else if (amounts.length) {
          claim._hasBadAmount = true
        }

      } else if (/\bADJUSTMENT\b/i.test(line) && /\bCONTRACTUAL\b/i.test(line)) {
        const val = amounts.find(a => a !== 0)
        if (val !== undefined) claim.adjustments = +(claim.adjustments + Math.abs(val)).toFixed(2)

      } else if (/\bPAYMENT\b/i.test(line)) {
        const source   = classifySource(line)
        const planName = extractPlanName(line) || (source === 'patient' ? 'Patient' : 'Insurance')
        const val      = amounts.find(a => a !== 0)
        if (val !== undefined) {
          const amt = Math.abs(val)
          const existing = claim.payments.find(p => p.source === source && p.planName === planName)
          if (existing) {
            existing.amount = +(existing.amount + amt).toFixed(2)
          } else {
            claim.payments.push({ source, planName, amount: amt })
          }
        }
      }
    }

    claims.push(claim)
  }

  // Detect grand total line at the end of the document
  const grandTotalMatch = text.match(/TOTAL\s+CHARGE\s+OUTSTANDING[^$]*\$([\d,]+\.\d{2})/i)
  const detectedTotal = grandTotalMatch
    ? parseFloat(grandTotalMatch[1].replace(/,/g, ''))
    : null

  const { score, issues } = scoreConfidence(claims, detectedTotal)
  const totals = aggregateTotals(claims)

  return { claims, totals, confidence: score, issues, parserUsed: 'athena-raw' }
}

const scoreConfidence = (claims, detectedTotal) => {
  if (claims.length === 0) return { score: 0, issues: ['No claims detected'] }

  const issues = []
  let score = 1.0

  // 1. Claims without any CHARGE detected
  const noCharge = claims.filter(c => !c._hasCharge).length
  if (noCharge) {
    score -= 0.35 * (noCharge / claims.length)
    issues.push(`${noCharge} claim(s) missing charge amount`)
  }

  // 2. Lines with OCR-corrupted amounts
  const badAmountClaims = claims.filter(c => c._hasBadAmount).length
  if (badAmountClaims) {
    score -= 0.25
    issues.push(`${badAmountClaims} claim(s) with OCR-corrupted amounts`)
  }

  // 3. Sum of charges vs grand total found in the document
  if (detectedTotal !== null) {
    const sumCharges = claims.reduce((s, c) => s + c.charge, 0)
    if (Math.abs(sumCharges - detectedTotal) > 1.00) {
      score -= 0.30
      issues.push(
        `Calculated total $${sumCharges.toFixed(2)} ≠ document total $${detectedTotal.toFixed(2)}`
      )
    }
  }

  return { score: Math.max(0, parseFloat(score.toFixed(2))), issues }
}

const buildZeroTotals = () => ({
  totalCharges: 0,
  totalAdjustments: 0,
  pipPaid: 0,
  healthPaid: 0,
  patientPaid: 0,
  outstanding: 0,
})

const aggregateTotals = (claims) => {
  const t = buildZeroTotals()
  for (const c of claims) {
    t.totalCharges     = +(t.totalCharges     + c.charge).toFixed(2)
    t.totalAdjustments = +(t.totalAdjustments + c.adjustments).toFixed(2)
    if (c.payments?.length) {
      // Raw Athena format: payment details in payments array
      for (const p of c.payments) {
        if (p.source === 'pip')     t.pipPaid     = +(t.pipPaid     + p.amount).toFixed(2)
        if (p.source === 'health')  t.healthPaid  = +(t.healthPaid  + p.amount).toFixed(2)
        if (p.source === 'patient') t.patientPaid = +(t.patientPaid + p.amount).toFixed(2)
      }
    } else {
      // Summary table format: direct payment fields
      t.pipPaid     = +(t.pipPaid     + (c.pipPaid     || 0)).toFixed(2)
      t.healthPaid  = +(t.healthPaid  + (c.healthPaid  || 0)).toFixed(2)
      t.patientPaid = +(t.patientPaid + (c.patientPaid || 0)).toFixed(2)
    }
  }
  t.outstanding = +(t.totalCharges - t.totalAdjustments - t.pipPaid - t.healthPaid - t.patientPaid).toFixed(2)
  return t
}

// Main entry point — handles PDF (text or scanned) and image files
const analyzeBillingDocument = async (filePath) => {
  try {
    const ext     = path.extname(filePath).toLowerCase()
    const isImage = IMAGE_EXTENSIONS.has(ext)

    let text    = ''
    let usedOcr = false

    if (isImage) {
      text    = await ocrExtractImage(filePath)
      usedOcr = true
    } else {
      text = await extractText(filePath)
      // Fall back to multi-page OCR if the PDF appears to be scanned (image-based)
      if (text.trim().length < OCR_THRESHOLD) {
        const ocrText = await ocrExtractMultiPages(filePath, 10)
        if (ocrText.trim().length > text.trim().length) {
          text    = ocrText
          usedOcr = true
        }
      }
    }

    if (!text || text.trim().length === 0) {
      return {
        claims: [],
        totals: buildZeroTotals(),
        confidence: 0,
        issues: ['Could not extract text from document'],
        extractedText: '',
        parserUsed: 'none',
        usedOcr,
        mlUsed: false,
      }
    }

    const result = parseBilling(text)

    // If regex parsers gave low confidence, try ML-NER before falling through to Gemini
    if (result.confidence < ML_CONFIDENCE_THRESHOLD) {
      const mlResult = await tryMlExtraction(text)
      if (mlResult) {
        return { ...mlResult, extractedText: text, usedOcr, mlUsed: true }
      }
    }

    return { ...result, extractedText: text, usedOcr, mlUsed: false }

  } catch (err) {
    console.error('Billing parser error:', err.message)
    return {
      claims: [],
      totals: buildZeroTotals(),
      confidence: 0,
      issues: ['Error al procesar el documento'],
      extractedText: '',
      usedOcr: false,
    }
  }
}

module.exports = { analyzeBillingDocument, parseBilling, aggregateTotals, buildZeroTotals }

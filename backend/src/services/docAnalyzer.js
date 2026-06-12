const fs   = require('fs')
const path = require('path')
const pdfParse = require('pdf-parse')
const Fuse = require('fuse.js')
const { ocrExtract, ocrExtractImage } = require('./ocr')

// File extensions treated as raster images — skip pdf-parse, go straight to OCR.
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp', '.webp'])

// If pdf-parse extracts fewer than this many characters the PDF is likely scanned,
// so we fall back to OCR before giving up on text extraction.
const OCR_THRESHOLD = 50

const extractText = async (filePath) => {
  const buffer = fs.readFileSync(filePath)
  const data = await pdfParse(buffer)
  return data.text || ''
}

/**
 * Counts how many times a provider name appears in the document text.
 * Short names (< 5 chars) use word boundaries to avoid spurious substring hits
 * (e.g. "AMR" matching inside "pharmacy").
 */
const countOccurrences = (text, name) => {
  if (name.length < 5) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi')
    return (text.match(re) || []).length
  }
  let count = 0
  let idx = 0
  const lower = text.toLowerCase()
  const lname = name.toLowerCase()
  while ((idx = lower.indexOf(lname, idx)) !== -1) { count++; idx += lname.length }
  return count
}

/**
 * Provider names that are generic medical/geographic words rather than real
 * entity names. The DB contains placeholder rows like "Hospital" or "Ambulance"
 * that would otherwise hijack matching, since those words appear in almost
 * every medical document.
 */
const GENERIC_NAMES = new Set([
  'hospital', 'ambulance', 'emergency', 'center', 'centre', 'clinic',
  'health', 'healthcare', 'medical', 'doctors', 'doctor', 'care',
  'group', 'provider', 'florida', 'imaging', 'radiology', 'pharmacy',
  // Billing vocabulary that appears in virtually every statement.
  'total', 'charges', 'charge', 'statement', 'patient', 'insurance',
  'balance', 'account', 'payment', 'adjustment', 'service', 'services',
  'jacksonville', 'orlando', 'tampa', 'miami',
])

const isGenericName = (name) => GENERIC_NAMES.has(name.trim().toLowerCase())

/**
 * Looks for an explicitly labelled provider line ("Provider:", "Facility:",
 * "Billing Provider:") and matches DB providers against that line only.
 * An explicit label is the strongest signal in the document, so this runs
 * before whole-document occurrence counting. Picks the longest non-generic
 * provider name contained in the line.
 */
const labeledProviderMatch = (text, providers) => {
  const m = /(?:^|\n)[ \t]*(?:billing\s+provider|treating\s+provider|provider|facility)\s*[:\-][ \t]*([^\n]+)/i.exec(text)
  if (!m) return null

  const line = m[1].trim()
  if (!line) return null

  // Prefer the match closest to the start of the line — entity names lead with
  // the brand ("HCA Florida Central Hospital" should match "HCA", not a
  // different facility named "Central Hospital"). Ties broken by longest name.
  let best = null
  let bestIdx = Infinity
  const lower = line.toLowerCase()
  for (const p of providers) {
    if (isGenericName(p.name)) continue
    if (countOccurrences(line, p.name) === 0) continue
    const idx = lower.indexOf(p.name.toLowerCase())
    if (idx === -1) continue
    if (idx < bestIdx || (idx === bestIdx && p.name.length > best.name.length)) {
      best = p
      bestIdx = idx
    }
  }

  if (!best) return null
  return {
    provider_id: best.id,
    name: best.name,
    confidence: 1.0,
    method: 'labeled',
    occurrences: 1,
  }
}

/**
 * Fuzzy-matches the document's first few lines against provider names.
 * Letterhead/title lines almost always name the billing entity, so a strong
 * fuzzy hit there ("UF HEALTH JACKSONVILLE" → "UF Jacksonville") is more
 * reliable than whole-document occurrence counting.
 */
const tokenize = (s) => s.toLowerCase().split(/[^a-z0-9&]+/).filter(t => t.length >= 2)

const headerMatch = (text, providers) => {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 4).slice(0, 8)

  let best = null
  for (const line of lines) {
    if (line.length > 60) continue
    const lineTokens = new Set(tokenize(line))
    if (lineTokens.size === 0) continue

    for (const p of providers) {
      if (isGenericName(p.name)) continue
      const nameTokens = tokenize(p.name)
      if (nameTokens.length === 0) continue

      // Every word of the provider name must appear in the line, and at least
      // one of them must be distinctive (not a generic word) — otherwise
      // "Jacksonville Center" would match any Jacksonville letterhead.
      if (!nameTokens.every(t => lineTokens.has(t))) continue
      if (!nameTokens.some(t => !GENERIC_NAMES.has(t))) continue

      if (!best || nameTokens.length > best.tokens ||
          (nameTokens.length === best.tokens && p.name.length > best.p.name.length)) {
        best = { p, tokens: nameTokens.length }
      }
    }
    if (best) break // first header line with a hit wins — it's the letterhead
  }

  if (!best) return null
  return {
    provider_id: best.p.id,
    name: best.p.name,
    confidence: 0.9,
    method: 'header',
  }
}

/**
 * Returns the provider whose name appears most often in the document (exact string match).
 * Ambulance providers are penalised (×0.6) so they lose tie-breakers against hospitals
 * or insurers — ambulance charges are secondary bills in most MVA cases.
 * Generic placeholder names ("Hospital", "Ambulance", ...) are skipped entirely.
 */
const exactMatch = (text, providers) => {
  let best = null
  let bestScore = 0

  for (const p of providers) {
    if (isGenericName(p.name)) continue
    const count = countOccurrences(text, p.name)
    if (count === 0) continue

    const score = p.type === 'Ambulance' ? count * 0.6 : count

    if (score > bestScore) {
      bestScore = score
      best = {
        provider_id: p.id,
        name: p.name,
        confidence: 1.0,
        method: 'exact',
        occurrences: count,
      }
    }
  }

  return best
}

/**
 * Slides a 4-word window across the document and fuzzy-matches each chunk against
 * provider names. Accumulates hits per provider rather than returning on the first
 * match, so a provider mentioned multiple times with slight OCR noise ranks higher.
 * Returns null if the best match confidence is below 0.4.
 */
const fuzzyMatch = (text, providers) => {
  const words = text.replace(/\n/g, ' ').split(/\s+/).filter(w => w.length >= 3)
  const chunks = []
  for (let i = 0; i < words.length - 2; i++) {
    chunks.push(words.slice(i, i + 4).join(' '))
  }

  const fuse = new Fuse(providers.filter(p => !isGenericName(p.name)), { keys: ['name'], threshold: 0.6, includeScore: true })

  // provider_id → { item, bestScore, hits }
  const scores = new Map()

  for (const chunk of chunks) {
    const results = fuse.search(chunk)
    if (!results.length) continue
    const r = results[0]
    const id = r.item.id
    const prev = scores.get(id)
    if (!prev || r.score < prev.bestScore) {
      scores.set(id, { item: r.item, bestScore: r.score, hits: (prev?.hits || 0) + 1 })
    } else if (prev) {
      prev.hits++
    }
  }

  if (scores.size === 0) return null

  // Pick the provider with the most hits; break ties by lowest (best) Fuse score.
  let best = null
  for (const entry of scores.values()) {
    if (
      !best ||
      entry.hits > best.hits ||
      (entry.hits === best.hits && entry.bestScore < best.bestScore)
    ) {
      best = entry
    }
  }

  const confidence = +(1 - best.bestScore).toFixed(2)
  if (confidence < 0.4) return null

  return {
    provider_id: best.item.id,
    name: best.item.name,
    confidence,
    method: 'fuzzy',
  }
}

/** Normalises a detected date to yyyy-mm-dd for HTML <input type="date">. */
const normalizeDate = (m, d, y) => {
  const month = m.padStart(2, '0')
  const day   = d.padStart(2, '0')
  // 2-digit years: ≤50 → 2000s, >50 → 1900s (handles legacy documents)
  const year  = y.length === 2 ? (parseInt(y) > 50 ? `19${y}` : `20${y}`) : y
  return `${year}-${month}-${day}`
}

const DATE_RE_SRC = '(\\d{1,2})[/\\-](\\d{1,2})[/\\-](\\d{2,4})'
const parseDateMatch = (m, offset = 1) =>
  normalizeDate(m[offset], m[offset + 1], m[offset + 2])

const isRecentYear = (yyyy) => {
  const y = parseInt(yyyy)
  return y >= 2000 && y <= 2099
}

/**
 * Extracts DOS (date of service) and statement/update dates from the document.
 *
 * DOS detection uses a priority cascade so explicit labels win over bare dates:
 *   1. Labelled range  "DOS: 01/25/2023 – 01/26/2023"
 *   2. Labelled single "DOS: 04/18/2026"
 *   3. "Date of Service" prose label (with optional range)
 *   4. "Service Date" label
 *   5. Fallback: all valid dates in the doc — earliest = dosStart, latest = dosEnd
 *
 * updateDate is extracted independently using statement/printed/as-of labels.
 */
const extractDates = (text) => {
  let m
  const result = {}

  m = new RegExp(`DOS[\\s:]+${DATE_RE_SRC}\\s*[-–to]+\\s*${DATE_RE_SRC}`, 'gi').exec(text)
  if (m) {
    result.dosStart = parseDateMatch(m, 1)
    result.dosEnd   = parseDateMatch(m, 4)
  }

  if (!result.dosStart) {
    m = new RegExp(`DOS[\\s:]+${DATE_RE_SRC}`, 'gi').exec(text)
    if (m) result.dosStart = parseDateMatch(m, 1)
  }

  if (!result.dosStart) {
    m = new RegExp(`Date\\s+of\\s+Service[:\\s]*${DATE_RE_SRC}(?:[^\\d]*${DATE_RE_SRC})?`, 'gi').exec(text)
    if (m) {
      result.dosStart = parseDateMatch(m, 1)
      if (m[4]) result.dosEnd = parseDateMatch(m, 4)
    }
  }

  if (!result.dosStart) {
    m = new RegExp(`Service\\s+Date[:\\s]*${DATE_RE_SRC}`, 'gi').exec(text)
    if (m) result.dosStart = parseDateMatch(m, 1)
  }

  if (!result.dosStart) {
    const allDates = []
    const allRe = new RegExp(DATE_RE_SRC, 'g')
    while ((m = allRe.exec(text)) !== null) {
      const month   = parseInt(m[1])
      const day     = parseInt(m[2])
      const yearRaw = m[3].length === 2 ? (parseInt(m[3]) > 50 ? `19${m[3]}` : `20${m[3]}`) : m[3]
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && isRecentYear(yearRaw)) {
        allDates.push(normalizeDate(m[1], m[2], m[3]))
      }
    }
    const sorted = [...new Set(allDates)].sort()
    if (sorted.length > 0) result.dosStart = sorted[0]
    if (sorted.length > 1) result.dosEnd   = sorted[sorted.length - 1]
  }

  // updateDate is always extracted independently of DOS.
  m = new RegExp(
    `(?:statement\\s+date|printed\\s+date|updated?\\s+as\\s+of|as\\s+of\\s+date)[:\\s]*${DATE_RE_SRC}`,
    'gi'
  ).exec(text)
  if (m) result.updateDate = parseDateMatch(m, 1)

  return result
}

/**
 * Strips numeric table rows and trims whitespace before sending text to Gemini.
 * Medical bills contain dense charge tables that waste tokens without adding
 * meaning for provider identification or date extraction.
 */
const prepareTextForAI = (text) => {
  return text
    .slice(0, 3000)
    .replace(/^\s*[\d\s.\-|,$]{15,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{4,}/g, '   ')
    .trim()
}

/**
 * Main entry point. Routes the file to the appropriate text extractor:
 *  - Images (JPG/PNG/etc.) → Tesseract OCR directly (no PDF render step needed)
 *  - PDFs with embedded text → pdf-parse
 *  - Scanned PDFs (text < OCR_THRESHOLD) → render page to image → Tesseract OCR
 *
 * Always returns extractedText so the caller can store it for the chat session.
 */
const analyzeDocument = async (filePath, providers) => {
  try {
    const ext = path.extname(filePath).toLowerCase()
    const isImage = IMAGE_EXTENSIONS.has(ext)

    let text = ''
    let usedOcr = false

    if (isImage) {
      // Image files go directly to OCR — no intermediate PDF rendering needed.
      text    = await ocrExtractImage(filePath)
      usedOcr = true
    } else {
      // pdf-parse throws on malformed PDFs (e.g. "bad XRef entry"); treat that
      // the same as an empty text layer so the OCR fallback still runs.
      try {
        text = await extractText(filePath)
      } catch (parseErr) {
        console.warn('pdf-parse failed, falling back to OCR:', parseErr.message)
        text = ''
      }

      if (text.trim().length < OCR_THRESHOLD) {
        try {
          text = await ocrExtract(filePath)
          usedOcr = true
        } catch (ocrErr) {
          console.error('OCR fallback failed:', ocrErr.message)
        }
      }
    }

    if (!text || text.trim().length === 0)
      return { suggestion: null, reason: 'Could not extract text from document', extractedText: '' }

    const dates = extractDates(text)
    const flags = detectFlags(text)

    const labeled = labeledProviderMatch(text, providers)
    if (labeled) return { suggestion: labeled, dates, flags, usedOcr, extractedText: text }

    const header = headerMatch(text, providers)
    if (header) return { suggestion: header, dates, flags, usedOcr, extractedText: text }

    const exact = exactMatch(text, providers)
    if (exact) return { suggestion: exact, dates, flags, usedOcr, extractedText: text }

    const fuzzy = fuzzyMatch(text, providers)
    if (fuzzy) return { suggestion: fuzzy, dates, flags, usedOcr, extractedText: text }

    return { suggestion: null, dates, flags, usedOcr, reason: 'No match found', extractedText: text }

  } catch (err) {
    console.error('Doc analyzer error:', err.message)
    return { suggestion: null, reason: 'Error processing document', extractedText: '' }
  }
}

const AMBULANCE_PATTERNS = [
  /\bambulance\b/i,
  /\bEMS\b/,   // uppercase-only to avoid matching "systems"
  /\bEMT\b/,
  /\bparamedic/i,
  /\bemergency\s+medical\s+(service|transport)/i,
  /\bair\s+(transport|ambulance)/i,
  /\bground\s+transport/i,
  /\bmedical\s+transport/i,
]

const REFERRAL_PATTERNS = [
  /\bfollow[\s-]?up\s+provider/i,           // "Follow-Up Providers" section
  /\bfollow[\s-]?up\s+with\s+(dr\.|doctor|physician|specialist)/i,
  /\breferred?\s+to\s+(dr\.|doctor|specialist|another)/i,
  /\boutpatient\s+referral/i,
  /\bconsult(?:ation)?\s+with\b/i,
  /\bsee\s+(dr\.|doctor|specialist)\b/i,
  /\bscheduled?\s+(?:for\s+)?(?:follow[\s-]?up|appointment)\s+with/i,
]

const extractAmbulanceCompany = (text) => {
  const STOP = /(?=\s*(?:ambulance\b|to the|arrived|transported|,|\.|$))/i
  const NAME = '([A-Z][A-Za-z\\s&\\-\\.]{2,50}?)'
  const patterns = [
    // "transported by American Medical Response" (para antes de "ambulance")
    new RegExp(`transported\\s+(?:by|via)\\s+${NAME}(?=\\s+(?:ambulance|ems|fire|rescue|paramedic)|\\s*[,\\.\\n])`, 'i'),
    // "Ambulance Service: Broward County Fire Rescue"
    new RegExp(`ambulance\\s+(?:service\\s*)?[:\\-]\\s*${NAME}(?=[,\\.\\n]|$)`, 'i'),
    // "EMS: Sunstar Paramedics"
    new RegExp(`\\bEMS\\s*[:\\-]\\s*${NAME}(?=[,\\.\\n]|$)`),
    // "[Company] ambulance" — non-greedy expande hasta "ambulance", captura Fire Rescue si está en el nombre
    new RegExp(`${NAME}\\s+ambulance`, 'i'),
  ]
  // Phrases that indicate the capture grabbed surrounding prose or table
  // headers ("Admission Type Emergency Department via") rather than a company.
  // "code"/"charg" without word boundaries: OCR often fuses table headers
  // into tokens like "CodeCharge" that boundary checks would miss.
  const NOT_A_COMPANY = /\b(via|type|department|admission|arrival|emergency|description|transport(?:ed)?)\b|cpt|code|charg/i

  for (const re of patterns) {
    const m = re.exec(text)
    if (m) {
      const name = m[1].trim().replace(/\s{2,}/g, ' ')
      if (name.length > 2 && name.length < 60 && !NOT_A_COMPANY.test(name)) return name
    }
  }
  return null
}

const detectFlags = (text) => {
  const hasAmbulance = AMBULANCE_PATTERNS.some(p => p.test(text))
  const ambulanceCompany = hasAmbulance ? extractAmbulanceCompany(text) : null

  const hasReferral = REFERRAL_PATTERNS.some(p => p.test(text))

  // Extraer nombres de proveedores referidos del bloque "Follow-Up Providers"
  const referrals = []
  const followUpBlock = text.match(/follow[\s-]?up\s+provider[s]?\s*\n([\s\S]{0,600}?)(?:\n\n|\f|billing|coding|document)/i)
  if (followUpBlock) {
    const SPECIALTY_LIST = 'internal medicine|cardiology|orthopedics|neurology|radiology|general surgery|psychiatry|pediatrics|dermatology|oncology|urology|nephrology|pulmonology|gastroenterology|physical therapy|chiropractic|pain management|ophthalmology|endocrinology'
    const TRAILING_SPECIALTY = new RegExp(`\\s*(${SPECIALTY_LIST})\\s*$`, 'gi')
    const HEADER_RE = /^(provider|specialty|contact|phone|name|providerspecialtycontact)$/i
    const PHONE_RE  = /\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}.*/g

    const lines = followUpBlock[1].split('\n').map(l => l.trim()).filter(l => l.length > 3)
    for (const line of lines) {
      if (HEADER_RE.test(line.replace(/\s/g, ''))) continue
      if (/^(dr\.|[A-Z][a-z]+\s+[A-Z]|[A-Z][a-z]+\s+(group|center|clinic|hospital|medical))/i.test(line)) {
        const name = line
          .replace(PHONE_RE, '')
          .replace(TRAILING_SPECIALTY, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
        if (name.length > 3) referrals.push(name)
      }
    }
  }

  return { hasAmbulance, ambulanceCompany, hasReferral, referrals }
}

module.exports = { analyzeDocument, extractDates, detectFlags, prepareTextForAI }
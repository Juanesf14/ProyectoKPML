/**
 * infer.js
 *
 * Node.js inference wrapper for the bill-ner ONNX model.
 * Extracts financial fields from OCR text of a medical bill.
 *
 * Usage (standalone test):
 *   node infer.js "Total Charges: $1,250.00  Insurance Paid: -$900.00  Balance Due: $350.00"
 *
 * Usage (as a module):
 *   const { extractBillingFields } = require('./infer')
 *   const fields = await extractBillingFields(ocrText)
 *   // → { totalCharge: 1250.00, adjustments: 0, pipPaid: 0, healthPaid: 900.00, ... }
 */

const path = require('path')
const fs   = require('fs')
const ort  = require('onnxruntime-node')

const MODELS_DIR = __dirname
const ONNX_PATH  = path.join(MODELS_DIR, 'bill-ner.onnx')
const TOK_DIR    = path.join(MODELS_DIR, 'tokenizer')

const LABEL_NAMES = ['O', 'B-CHARGE', 'B-ADJUST', 'B-PIP', 'B-HEALTH', 'B-PATIENT', 'B-OUTSTANDING']
const MAX_LENGTH  = 512

// ── Tokenizer (WordPiece, loaded from vocab.txt) ──────────────────────────────

class SimpleWordPieceTokenizer {
  constructor(vocabPath) {
    const lines = fs.readFileSync(vocabPath, 'utf8').trim().split('\n')
    this.vocab  = {}
    this.ids    = []
    lines.forEach((tok, i) => { this.vocab[tok] = i; this.ids[i] = tok })
    this.unkId  = this.vocab['[UNK]'] ?? 100
    this.clsId  = this.vocab['[CLS]'] ?? 101
    this.sepId  = this.vocab['[SEP]'] ?? 102
    this.padId  = this.vocab['[PAD]'] ?? 0
  }

  tokenizeWord(word) {
    // Greedy longest-match WordPiece
    word = word.toLowerCase()
    if (this.vocab[word] !== undefined) return [{ id: this.vocab[word], text: word }]
    const tokens = []
    let start = 0
    while (start < word.length) {
      let end = word.length
      let found = null
      while (end > start) {
        const sub = (start === 0 ? '' : '##') + word.slice(start, end)
        if (this.vocab[sub] !== undefined) { found = { id: this.vocab[sub], text: sub }; break }
        end--
      }
      if (!found) return [{ id: this.unkId, text: '[UNK]' }]
      tokens.push(found)
      start = end
    }
    return tokens
  }

  encode(text, maxLength = MAX_LENGTH) {
    // Basic whitespace + punctuation pre-tokenization (mirrors BERT's BasicTokenizer)
    const rawWords = text
      .replace(/([.,\-\$\(\)\[\]:;])/g, ' $1 ')
      .split(/\s+/)
      .filter(Boolean)

    const tokenIds = [this.clsId]
    const wordIds  = [null]   // CLS has no word

    for (let wi = 0; wi < rawWords.length; wi++) {
      const pieces = this.tokenizeWord(rawWords[wi])
      for (const p of pieces) {
        if (tokenIds.length >= maxLength - 1) break
        tokenIds.push(p.id)
        wordIds.push(wi)
      }
      if (tokenIds.length >= maxLength - 1) break
    }

    tokenIds.push(this.sepId)
    wordIds.push(null)

    const attentionMask = new Array(tokenIds.length).fill(1)

    return { input_ids: tokenIds, attention_mask: attentionMask, word_ids: wordIds }
  }
}

// ── ONNX session (lazy singleton) ────────────────────────────────────────────

let _session    = null
let _tokenizer  = null

async function getSession() {
  if (!_session) {
    if (!fs.existsSync(ONNX_PATH)) {
      throw new Error(`ONNX model not found at ${ONNX_PATH}. Run export_onnx.py first.`)
    }
    _session   = await ort.InferenceSession.create(ONNX_PATH)
    _tokenizer = new SimpleWordPieceTokenizer(path.join(TOK_DIR, 'vocab.txt'))
  }
  return { session: _session, tokenizer: _tokenizer }
}

// ── Field extraction ─────────────────────────────────────────────────────────

function parseAmount(tokenText) {
  // Extract numeric value from tokens like "$1,250", ".00", "##00", "-$900"
  const combined = tokenText.replace(/##/g, '').replace(/,/g, '')
  const m = combined.match(/-?\$?([\d]+\.?[\d]*)/)
  return m ? parseFloat(m[1]) : null
}

/**
 * Runs the NER model on OCR text and returns extracted financial fields.
 *
 * @param {string} text  OCR text from a medical bill
 * @returns {Promise<{
 *   totalCharge: number,
 *   adjustments: number,
 *   pipPaid: number,
 *   healthPaid: number,
 *   patientPaid: number,
 *   outstanding: number,
 *   confidence: number,
 *   fieldsFound: string[]
 * }>}
 */
async function extractBillingFields(text) {
  const { session, tokenizer } = await getSession()
  const enc = tokenizer.encode(text)

  const inputIds      = BigInt64Array.from(enc.input_ids.map(BigInt))
  const attentionMask = BigInt64Array.from(enc.attention_mask.map(BigInt))

  const feeds = {
    input_ids:      new ort.Tensor('int64', inputIds,      [1, enc.input_ids.length]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, enc.attention_mask.length]),
  }

  const results = await session.run(feeds)
  const logits  = results.logits.data   // Float32Array, shape [1, seq, num_labels]
  const seqLen  = enc.input_ids.length
  const nLabels = LABEL_NAMES.length

  // Per-token argmax
  const tokenLabels = []
  for (let i = 0; i < seqLen; i++) {
    let maxVal = -Infinity, maxIdx = 0
    for (let l = 0; l < nLabels; l++) {
      const v = logits[i * nLabels + l]
      if (v > maxVal) { maxVal = v; maxIdx = l }
    }
    tokenLabels.push(LABEL_NAMES[maxIdx])
  }

  // Collect token texts for labeled positions (skip CLS/SEP at idx 0 and last)
  const vocab = tokenizer.ids
  const fieldAmounts = {
    'B-CHARGE':      [],
    'B-ADJUST':      [],
    'B-PIP':         [],
    'B-HEALTH':      [],
    'B-PATIENT':     [],
    'B-OUTSTANDING': [],
  }

  for (let i = 1; i < seqLen - 1; i++) {
    const label = tokenLabels[i]
    if (label === 'O') continue
    const tok = vocab[enc.input_ids[i]] || ''
    const amount = parseAmount(tok)
    if (amount !== null && amount >= 0) {
      fieldAmounts[label].push(amount)
    }
  }

  // For each field, take the max value found (total charges are usually the largest)
  const pick = (arr) => arr.length ? Math.max(...arr) : 0

  const totalCharge = pick(fieldAmounts['B-CHARGE'])
  const adjustments = pick(fieldAmounts['B-ADJUST'])
  const pipPaid     = pick(fieldAmounts['B-PIP'])
  const healthPaid  = pick(fieldAmounts['B-HEALTH'])
  const patientPaid = pick(fieldAmounts['B-PATIENT'])
  const outstanding = pick(fieldAmounts['B-OUTSTANDING'])

  const fieldsFound = Object.entries(fieldAmounts)
    .filter(([, v]) => v.length > 0)
    .map(([k]) => k.replace('B-', ''))

  const confidence = fieldsFound.length / 6

  return { totalCharge, adjustments, pipPaid, healthPaid, patientPaid, outstanding, confidence, fieldsFound }
}

// ── CLI test ──────────────────────────────────────────────────────────────────

if (require.main === module) {
  const text = process.argv.slice(2).join(' ') ||
    'Total Charges: $1,250.00  Contractual Adjustment: -$387.50  Insurance Paid: -$712.50  Patient Balance Due: $150.00'

  console.log('Input text:\n', text, '\n')

  getSession()
    .then(() => extractBillingFields(text))
    .then(fields => {
      console.log('Extracted fields:')
      console.log(JSON.stringify(fields, null, 2))
    })
    .catch(err => {
      console.error('Error:', err.message)
      process.exit(1)
    })
}

module.exports = { extractBillingFields }

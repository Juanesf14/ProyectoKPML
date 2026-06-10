const { GoogleGenerativeAI } = require('@google/generative-ai')

// Strips noise and limits text size before sending to Gemini.
// Billing docs are multi-page; 8000 chars covers most claim lists without
// exceeding token limits on gemini-flash-lite.
const prepareBillingText = (text) => {
  return text
    .slice(0, 8000)
    .replace(/^\s*[\d\s.\-|,$]{15,}\s*$/gm, '')  // strip dense numeric table rows
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{4,}/g, '   ')
    .trim()
}

const analyzeBillingWithAI = async (text) => {
  if (!process.env.GEMINI_API_KEY) return null

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' })

  const cleanText = prepareBillingText(text)

  const prompt = `You are a medical billing parser for personal injury (PI) law cases.
Analyze this medical billing document (it may be from Athena, Kareo, eClinicalWorks, or any practice management system) and extract structured financial data per claim.

Rules:
- charge: the total billed / charged amount for each claim (all procedure lines summed)
- adjustments: any contractual write-offs, adjustments, or reductions to the billed amount
- pipPaid: amounts paid by PIP, Personal Injury Protection, or auto insurance
- healthPaid: amounts paid by health insurance (non-PIP) plans, ACH payments, or HMO/PPO
- patientPaid: amounts paid by the patient directly (copay, cash, unapplied credits, self-pay)
- TRANSFERIN or internal accounting entries — IGNORE completely
- A document may have different column names (Billed, Charged, Allowed) — map to charge
- If the source is a summary table, each row is one claim; read the column headers to map amounts
- One claim may span multiple procedure lines; sum all procedure amounts into the same claim ID

Document:
${cleanText}

Respond with JSON only (no markdown, no explanation):
{
  "claims": [
    {
      "claimId": "253788",
      "charge": 270.00,
      "adjustments": 147.93,
      "pipPaid": 0.00,
      "healthPaid": 92.07,
      "patientPaid": 30.00
    }
  ],
  "totals": {
    "totalCharges": 0.00,
    "totalAdjustments": 0.00,
    "pipPaid": 0.00,
    "healthPaid": 0.00,
    "patientPaid": 0.00,
    "outstanding": 0.00
  }
}`

  try {
    const result = await model.generateContent(prompt)
    const raw    = result.response.text().trim()
    const clean  = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(clean)

    // Recalculate outstanding from totals to guarantee consistency
    if (parsed.totals) {
      parsed.totals.outstanding = +(
        (parsed.totals.totalCharges    || 0) -
        (parsed.totals.totalAdjustments || 0) -
        (parsed.totals.pipPaid          || 0) -
        (parsed.totals.healthPaid       || 0) -
        (parsed.totals.patientPaid      || 0)
      ).toFixed(2)
    }

    return parsed
  } catch (err) {
    console.error('Billing AI error:', err.message)
    return null
  }
}

module.exports = { analyzeBillingWithAI }

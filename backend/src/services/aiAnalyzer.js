const { GoogleGenerativeAI } = require('@google/generative-ai')

/**
 * Secondary analysis pass using Gemini Flash Lite.
 * Called by /api/analyze only when regex + fuzzy confidence is below threshold.
 *
 * Returns a parsed JSON object with provider match, dates, and flags,
 * or null on any API/parse error (the caller falls back gracefully).
 */
const analyzeWithAI = async (text, providers) => {
  if (!process.env.GEMINI_API_KEY) return null

  const providerList = providers.map(p => `- "${p.name}" (id: ${p.id})`).join('\n')

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' })

  const prompt = `You are a medical document parser. Analyze this document and respond with JSON only (no explanation, no markdown fences).

Known providers:
${providerList}

Tasks:
1. Match the billing or treating entity in the document to one provider from the list above
2. Extract date of service start and end (format: yyyy-mm-dd)
3. Extract statement or update date (format: yyyy-mm-dd)
4. Detect ambulance transport and company name if present
5. Detect specialist referrals if present
6. Classify document type: B=Medical Bill, MR=Medical Records, PD=Police Report, LT=Letter, RX=Prescription, IN=Insurance, OT=Other

Document:
${text}

Respond with this exact JSON (null for missing fields):
{"provider_id":null,"provider_name":null,"confidence":0.0,"dosStart":null,"dosEnd":null,"updateDate":null,"hasAmbulance":false,"ambulanceCompany":null,"hasReferral":false,"referrals":[],"suggestedDocType":null}`

  try {
    const result = await model.generateContent(prompt)
    const raw = result.response.text().trim()
    // Strip markdown fences that some model versions add despite the instruction.
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(clean)
  } catch (err) {
    console.error('AI analyzer error:', err.message)
    return null
  }
}

module.exports = { analyzeWithAI }

#!/usr/bin/env node
/**
 * render_bills.js
 *
 * Reads Synthea CSV output and renders synthetic medical bills as PDFs.
 * Each bill is saved alongside a JSON label file containing ground-truth
 * financial values for ML training.
 *
 * Bill formats rendered (randomly assigned per bill):
 *   1. athena-raw      — Claim ID blocks with CHARGE/PAYMENT/ADJUSTMENT lines
 *   2. cpt-itemized    — CPT code table with charge/allowed/patient columns
 *   3. hospital-totals — Grand total summary (UB-04 style)
 *   4. statement       — Running account statement with chronological entries
 */

const fs   = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')

const ML_DIR      = path.join(__dirname, '..')
const CSV_DIR     = path.join(ML_DIR, 'data', 'synthea-output', 'csv')
const BILLS_DIR   = path.join(ML_DIR, 'data', 'rendered-bills')
const LABELS_DIR  = path.join(ML_DIR, 'data', 'labels')

const FORMATS = ['athena-raw', 'cpt-itemized', 'hospital-totals', 'statement']

// PI_RATE: fraction of claims that will have a PIP payment layer added
const PI_RATE = 0.25

// ── CSV helpers ───────────────────────────────────────────────────────────────

function readCsv(filename) {
  const rows = []
  const text = fs.readFileSync(path.join(CSV_DIR, filename), 'utf8')
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',')
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i])
    const obj = {}
    headers.forEach((h, idx) => { obj[h.trim()] = (vals[idx] || '').trim() })
    rows.push(obj)
  }
  return rows
}

function splitCsvLine(line) {
  const result = []
  let cur = '', inQuote = false
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { result.push(cur); cur = '' }
    else cur += ch
  }
  result.push(cur)
  return result
}

// ── Data loading & aggregation ────────────────────────────────────────────────

function loadData() {
  const payers    = {}
  const patients  = {}
  const providers = {}
  const orgs      = {}

  readCsv('payers.csv').forEach(r => { payers[r.Id] = r.NAME })
  readCsv('patients.csv').forEach(r => { patients[r.Id] = r })
  readCsv('providers.csv').forEach(r => { providers[r.Id] = r })
  readCsv('organizations.csv').forEach(r => { orgs[r.Id] = r })

  // MEMBERID → payer name (PATIENTINSURANCEID in transactions = MEMBERID here)
  const memberPayer = {}
  readCsv('payer_transitions.csv').forEach(r => {
    memberPayer[r.MEMBERID] = payers[r.PAYER] || 'Insurance'
  })

  // Group transactions by claim
  const claimTxns = {}
  readCsv('claims_transactions.csv').forEach(r => {
    if (!claimTxns[r.CLAIMID]) claimTxns[r.CLAIMID] = []
    claimTxns[r.CLAIMID].push(r)
  })

  // Load claim headers for patient/provider/payer references
  const claimHeaders = {}
  readCsv('claims.csv').forEach(r => { claimHeaders[r.Id] = r })

  return { payers, patients, providers, orgs, claimTxns, claimHeaders, memberPayer }
}

function aggregateClaim(claimId, txns, claimHeader, payers, patients, providers, orgs, memberPayer) {
  let totalCharge = 0
  const paymentsByPayer = {}
  const lineItems = []
  let serviceDate = ''

  for (const t of txns) {
    const chargeAmt   = parseFloat(t.AMOUNT)   || 0
    const paymentAmt  = parseFloat(t.PAYMENTS)  || 0

    if (t.TYPE === 'CHARGE' && chargeAmt > 0) {
      totalCharge += chargeAmt
      serviceDate = serviceDate || (t.FROMDATE || '').slice(0, 10)
      const cpt  = t.PROCEDURECODE || '99213'
      const desc = t.NOTES || 'Office Visit'
      lineItems.push({ cpt, desc, charge: chargeAmt })
    }

    // PAYMENTS field holds the actual amount paid (AMOUNT is empty on PAYMENT rows)
    if (t.TYPE === 'PAYMENT' && paymentAmt > 0) {
      const memberId  = t.PATIENTINSURANCEID || ''
      const payerName = memberPayer[memberId] || 'Patient'
      if (!paymentsByPayer[payerName]) paymentsByPayer[payerName] = 0
      paymentsByPayer[payerName] += paymentAmt
    }
  }

  if (totalCharge === 0) return null

  // Simulate contractual adjustments: commercial insurance adjusts 30-45%
  const hasInsurance = Object.keys(paymentsByPayer).some(
    p => !['Patient', 'NO_INSURANCE'].includes(p)
  )
  const adjRate = hasInsurance ? 0.30 + Math.random() * 0.15 : 0
  const adjustments = parseFloat((totalCharge * adjRate).toFixed(2))

  // Separate insurance vs patient payments
  let healthPaid = 0
  let patientPaid = 0
  let pipPaid = 0

  const isPiCase = Math.random() < PI_RATE

  for (const [name, amt] of Object.entries(paymentsByPayer)) {
    if (name === 'Patient' || name === 'NO_INSURANCE') {
      patientPaid += amt
    } else {
      healthPaid += amt
    }
  }

  // For PI cases: reassign some health payment to PIP
  if (isPiCase && healthPaid > 0) {
    pipPaid = parseFloat(Math.min(healthPaid * 0.6, 10000).toFixed(2))
    healthPaid = parseFloat((healthPaid - pipPaid).toFixed(2))
    if (healthPaid < 0) healthPaid = 0
  }

  // Round all values
  healthPaid  = parseFloat(healthPaid.toFixed(2))
  patientPaid = parseFloat(patientPaid.toFixed(2))

  const outstanding = parseFloat(
    (totalCharge - adjustments - pipPaid - healthPaid - patientPaid).toFixed(2)
  )

  // Provider / patient info
  const providerId = claimHeader?.PROVIDERID || ''
  const provider   = providers[providerId] || {}
  const orgId      = provider.ORGANIZATION || ''
  const org        = orgs[orgId] || {}
  const providerName = org.NAME || provider.NAME || 'Medical Center'

  const patientId  = claimHeader?.PATIENTID || ''
  const patient    = patients[patientId] || {}
  const patientName = `${patient.FIRST || 'John'} ${patient.LAST || 'Doe'}`
  const patientDOB  = (patient.BIRTHDATE || '').slice(0, 10)

  // Primary payer name
  const primaryPayerId   = claimHeader?.PRIMARYPATIENTINSURANCEID || ''
  const primaryPayerName = payers[primaryPayerId] || 'Self-Pay'

  return {
    claimId: claimId.slice(0, 8).toUpperCase(),
    serviceDate,
    providerName,
    patientName,
    patientDOB,
    primaryPayerName,
    isPiCase,
    lineItems,
    totalCharge,
    adjustments,
    pipPaid,
    healthPaid,
    patientPaid,
    outstanding: Math.max(0, outstanding),
  }
}

// ── PDF renderers ─────────────────────────────────────────────────────────────

const FONTS = { normal: 'Helvetica', bold: 'Helvetica-Bold' }

function money(n) {
  return `$${Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function renderAthenaRaw(doc, bill) {
  const { lineItems, claimId, serviceDate, providerName,
          patientName, primaryPayerName,
          totalCharge, adjustments, pipPaid, healthPaid, patientPaid, outstanding } = bill

  doc.font(FONTS.bold).fontSize(14).text(providerName, { align: 'center' })
  doc.font(FONTS.normal).fontSize(9)
     .text('Medical Billing Statement', { align: 'center' })
     .moveDown(0.5)

  doc.font(FONTS.normal).fontSize(9)
  doc.text(`Patient: ${patientName}`)
  doc.text(`Insurance: ${primaryPayerName}`)
  doc.text(`Statement Date: ${new Date().toISOString().slice(0, 10)}`)
  doc.moveDown(1)

  // Claim block
  doc.font(FONTS.bold).fontSize(10).text(`Claim ID ${claimId}`)
  doc.font(FONTS.normal).fontSize(9)
  doc.text(`Service Date: ${serviceDate}`)
  doc.moveDown(0.3)

  for (const item of lineItems) {
    doc.text(`  CHARGE   ${item.desc.slice(0, 45).padEnd(46)} ${money(item.charge)}`)
  }
  doc.moveDown(0.2)

  if (adjustments > 0)
    doc.text(`  ADJUSTMENT  CONTRACTUAL                         -${money(adjustments)}`)
  if (pipPaid > 0)
    doc.text(`  PAYMENT     PIP AUTO INSURANCE                  -${money(pipPaid)}`)
  if (healthPaid > 0)
    doc.text(`  PAYMENT     ${primaryPayerName.slice(0, 30).padEnd(31)} -${money(healthPaid)}`)
  if (patientPaid > 0)
    doc.text(`  PAYMENT     PATIENT                             -${money(patientPaid)}`)

  doc.moveDown(0.4)
  doc.font(FONTS.bold)
     .text(`  OUTSTANDING ${money(outstanding)}`)

  doc.moveDown(1)
  doc.font(FONTS.bold).fontSize(9)
     .text(`TOTAL CHARGE OUTSTANDING  ${money(totalCharge)}`)
}

function renderCptItemized(doc, bill) {
  const { lineItems, providerName, patientName, patientDOB,
          serviceDate, primaryPayerName,
          totalCharge, adjustments, pipPaid, healthPaid, patientPaid, outstanding } = bill

  doc.font(FONTS.bold).fontSize(14).text(providerName, { align: 'center' })
  doc.font(FONTS.normal).fontSize(9).text('Itemized Bill', { align: 'center' })
  doc.moveDown(0.5)

  doc.font(FONTS.normal).fontSize(9)
  doc.text(`Patient: ${patientName}    DOB: ${patientDOB}`)
  doc.text(`Insurance: ${primaryPayerName}`)
  doc.text(`Date of Service: ${serviceDate}`)
  doc.moveDown(0.8)

  // Table header
  doc.font(FONTS.bold).fontSize(8)
  doc.text('CPT Code  Description                              Charge      Ins. Allowed  Patient')
  doc.moveTo(doc.x, doc.y).lineTo(550, doc.y).stroke()
  doc.font(FONTS.normal).fontSize(8)

  let sumCharge = 0, sumPatient = 0
  for (const item of lineItems) {
    const allowed    = parseFloat((item.charge * 0.7).toFixed(2))
    const patientAmt = parseFloat((item.charge * 0.1).toFixed(2))
    sumCharge  += item.charge
    sumPatient += patientAmt
    const row = `${item.cpt.padEnd(10)}${item.desc.slice(0, 40).padEnd(42)}` +
                `${money(item.charge).padStart(10)}  ${money(allowed).padStart(12)}  ${money(patientAmt).padStart(8)}`
    doc.text(row)
  }

  doc.moveTo(doc.x, doc.y).lineTo(550, doc.y).stroke()
  doc.moveDown(0.5)
  doc.font(FONTS.bold).fontSize(9)
  doc.text(`Total Gross Charges: ${money(totalCharge)}`)
  doc.font(FONTS.normal)
  if (adjustments > 0) doc.text(`Contractual Adjustments: -${money(adjustments)}`)
  if (pipPaid > 0)     doc.text(`PIP / Auto Insurance Paid: -${money(pipPaid)}`)
  if (healthPaid > 0)  doc.text(`Insurance Paid: -${money(healthPaid)}`)
  if (patientPaid > 0) doc.text(`Patient Payments: -${money(patientPaid)}`)
  doc.font(FONTS.bold).text(`Patient Balance Due: ${money(outstanding)}`)
}

function renderHospitalTotals(doc, bill) {
  const { providerName, patientName, patientDOB, serviceDate,
          primaryPayerName, claimId,
          totalCharge, adjustments, pipPaid, healthPaid, patientPaid, outstanding, isPiCase } = bill

  doc.font(FONTS.bold).fontSize(16).text(providerName, { align: 'center' })
  doc.font(FONTS.normal).fontSize(9).text('Patient Account Summary', { align: 'center' })
  doc.moveDown(0.8)

  // Two-column header
  doc.font(FONTS.normal).fontSize(9)
  doc.text(`Account Number: ${claimId}                   Date of Service: ${serviceDate}`)
  doc.text(`Patient Name: ${patientName}`)
  doc.text(`Date of Birth: ${patientDOB}`)
  doc.text(`Primary Insurance: ${primaryPayerName}`)
  if (isPiCase) doc.text('Secondary Insurance: PIP / Personal Injury Protection')
  doc.moveDown(1)

  // Financial summary box
  doc.rect(doc.page.margins.left, doc.y, 480, isPiCase ? 160 : 130).stroke()
  const boxY = doc.y + 8
  doc.y = boxY
  doc.x = doc.page.margins.left + 10

  const row = (label, val, bold = false) => {
    const font = bold ? FONTS.bold : FONTS.normal
    doc.font(font).fontSize(9)
       .text(label, doc.page.margins.left + 10, doc.y)
    doc.font(bold ? FONTS.bold : FONTS.normal).fontSize(9)
       .text(val, 400, doc.y - doc.currentLineHeight(), { lineBreak: false })
    doc.moveDown(0.5)
  }

  row('Total Charges:', money(totalCharge))
  if (adjustments > 0) row('Contractual Adjustment:', `-${money(adjustments)}`)
  if (isPiCase && pipPaid > 0) row('PIP / Auto Insurance Paid Amount:', `-${money(pipPaid)}`)
  if (healthPaid > 0) row('Insurance Paid Amount:', `-${money(healthPaid)}`)
  if (patientPaid > 0) row('Patient Payment:', `-${money(patientPaid)}`)
  row('Patient Balance Due:', money(outstanding), true)

  doc.moveDown(1)
  doc.font(FONTS.normal).fontSize(8)
     .text('For billing questions please contact our billing department.', { align: 'center' })
}

function renderStatement(doc, bill) {
  const { providerName, patientName, claimId, serviceDate,
          primaryPayerName,
          totalCharge, adjustments, pipPaid, healthPaid, patientPaid, outstanding } = bill

  doc.font(FONTS.bold).fontSize(13).text(providerName, { align: 'center' })
  doc.font(FONTS.normal).fontSize(9).text('Statement of Account', { align: 'center' })
  doc.moveDown(0.5)

  doc.font(FONTS.normal).fontSize(9)
  doc.text(`Patient: ${patientName}     Account #: ${claimId}`)
  doc.text(`Insurance: ${primaryPayerName}`)
  doc.moveDown(0.8)

  // Column headers
  doc.font(FONTS.bold).fontSize(8)
  doc.text('Date          Description                          Charges     Payments    Balance')
  doc.moveTo(doc.x, doc.y).lineTo(550, doc.y).stroke()
  doc.font(FONTS.normal).fontSize(8)

  let runningBalance = 0

  // Service charge
  runningBalance += totalCharge
  doc.text(`${serviceDate}  Service Charges                        ${money(totalCharge).padStart(10)}              ${money(runningBalance).padStart(10)}`)

  // Adjustment
  if (adjustments > 0) {
    runningBalance -= adjustments
    doc.text(`${serviceDate}  Contractual Adjustment                             ${money(adjustments).padStart(10)}  ${money(runningBalance).padStart(10)}`)
  }

  // PIP payment
  if (pipPaid > 0) {
    runningBalance -= pipPaid
    doc.text(`${serviceDate}  PIP Auto Insurance                                 ${money(pipPaid).padStart(10)}  ${money(runningBalance).padStart(10)}`)
  }

  // Health insurance payment
  if (healthPaid > 0) {
    runningBalance -= healthPaid
    const label = primaryPayerName.slice(0, 20)
    doc.text(`${serviceDate}  ${label.padEnd(22)}                          ${money(healthPaid).padStart(10)}  ${money(runningBalance).padStart(10)}`)
  }

  // Patient payment
  if (patientPaid > 0) {
    runningBalance -= patientPaid
    doc.text(`${serviceDate}  Patient Payment                                    ${money(patientPaid).padStart(10)}  ${money(runningBalance).padStart(10)}`)
  }

  doc.moveTo(doc.x, doc.y).lineTo(550, doc.y).stroke()
  doc.moveDown(0.3)
  doc.font(FONTS.bold).fontSize(9)
     .text(`Current Balance Due: ${money(Math.max(0, runningBalance))}`, { align: 'right' })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(BILLS_DIR, { recursive: true })
  fs.mkdirSync(LABELS_DIR, { recursive: true })

  console.log('Loading Synthea data...')
  const { payers, patients, providers, orgs, claimTxns, claimHeaders, memberPayer } = loadData()

  const claimIds = Object.keys(claimTxns)
  console.log(`Found ${claimIds.length} claims — rendering bills...`)

  let rendered = 0
  let skipped  = 0

  for (const claimId of claimIds) {
    const header = claimHeaders[claimId] || {}
    const bill   = aggregateClaim(claimId, claimTxns[claimId], header, payers, patients, providers, orgs, memberPayer)

    if (!bill || bill.totalCharge === 0) { skipped++; continue }

    const format   = FORMATS[Math.floor(Math.random() * FORMATS.length)]
    const filename = `bill_${rendered.toString().padStart(5, '0')}_${format}`

    // Render PDF
    const pdfPath = path.join(BILLS_DIR, `${filename}.pdf`)
    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 } })
      const stream = fs.createWriteStream(pdfPath)
      doc.pipe(stream)

      try {
        if (format === 'athena-raw')      renderAthenaRaw(doc, bill)
        else if (format === 'cpt-itemized')    renderCptItemized(doc, bill)
        else if (format === 'hospital-totals') renderHospitalTotals(doc, bill)
        else                                   renderStatement(doc, bill)
      } catch (e) {
        console.warn(`  Render error on ${claimId}: ${e.message}`)
      }

      doc.end()
      stream.on('finish', resolve)
      stream.on('error', reject)
    })

    // Write label JSON
    const label = {
      filename: `${filename}.pdf`,
      format,
      claimId:        bill.claimId,
      serviceDate:    bill.serviceDate,
      providerName:   bill.providerName,
      patientName:    bill.patientName,
      isPiCase:       bill.isPiCase,
      totalCharge:    bill.totalCharge,
      adjustments:    bill.adjustments,
      pipPaid:        bill.pipPaid,
      healthPaid:     bill.healthPaid,
      patientPaid:    bill.patientPaid,
      outstanding:    bill.outstanding,
    }
    fs.writeFileSync(path.join(LABELS_DIR, `${filename}.json`), JSON.stringify(label, null, 2))

    rendered++
    if (rendered % 50 === 0) process.stdout.write(`  ${rendered} bills rendered...\r`)
  }

  console.log(`\nDone. Rendered: ${rendered}  Skipped (no charge): ${skipped}`)
  console.log(`Bills → ${BILLS_DIR}`)
  console.log(`Labels → ${LABELS_DIR}`)

  // Summary stats
  const formats = {}
  FORMATS.forEach(f => { formats[f] = 0 })
  fs.readdirSync(LABELS_DIR).forEach(f => {
    if (!f.endsWith('.json')) return
    const label = JSON.parse(fs.readFileSync(path.join(LABELS_DIR, f)))
    formats[label.format] = (formats[label.format] || 0) + 1
  })
  console.log('\nFormat distribution:')
  Object.entries(formats).forEach(([f, n]) => console.log(`  ${f.padEnd(20)}: ${n}`))
}

main().catch(err => { console.error(err); process.exit(1) })

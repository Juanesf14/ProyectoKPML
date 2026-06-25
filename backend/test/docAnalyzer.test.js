const { test } = require('node:test')
const assert = require('node:assert/strict')
const { extractDates, detectDocType } = require('../src/services/docAnalyzer')

test('extractDates: single DOS date', () => {
  const d = extractDates('DOS: 05/21/2026')
  assert.equal(d.dosStart, '2026-05-21')
})

test('extractDates: DOS range', () => {
  const d = extractDates('DOS 01/02/2026 to 01/09/2026')
  assert.equal(d.dosStart, '2026-01-02')
  assert.equal(d.dosEnd, '2026-01-09')
})

test('extractDates: statement date maps to updateDate', () => {
  const d = extractDates('Statement Date: 06/24/2026')
  assert.equal(d.updateDate, '2026-06-24')
})

test('extractDates: no dates found', () => {
  const d = extractDates('no dates in this text at all')
  assert.equal(d.dosStart, undefined)
})

test('detectDocType: classifies each category', () => {
  const cases = {
    B:   'Statement of Account Total Charges Amount Due CPT 99213',
    MR:  'Progress Notes Office Visit History and Physical',
    PIP: 'Personal Injury Protection PIP Log benefits paid',
    HL:  'Notice of Health Lien Letter of Protection subrogation',
    PD:  'Florida Traffic Crash Report investigating officer',
    IN:  'Declarations Page Policy Number coverage premium',
    RX:  'Prescription Pharmacy Refills dispense as written',
  }
  for (const [code, text] of Object.entries(cases)) {
    assert.equal(detectDocType(text), code, `expected ${code} for: ${text}`)
  }
})

test('detectDocType: returns null when nothing matches', () => {
  assert.equal(detectDocType('hello world random text'), null)
  assert.equal(detectDocType(''), null)
})

test('detectDocType: scoring picks the strongest category', () => {
  // Mentions "patient" (common in bills) but is clearly a medical record.
  const text = 'Patient progress notes, history and physical, discharge summary'
  assert.equal(detectDocType(text), 'MR')
})

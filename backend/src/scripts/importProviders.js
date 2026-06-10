#!/usr/bin/env node
/**
 * Importa medical providers desde un CSV exportado de Outlook Contacts.
 * Uso: node importProviders.js <ruta_al_csv>
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') })

const fs = require('fs')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const db = require('../db/schema')

const csvPath = process.argv[2]
if (!csvPath) {
  console.error('Uso: node importProviders.js <ruta_al_csv>')
  process.exit(1)
}

const raw = fs.readFileSync(path.resolve(csvPath), 'utf-8')

// Parser CSV que maneja campos entre comillas con comas internas
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  const result = []
  for (const line of lines) {
    const row = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        row.push(field.trim())
        field = ''
      } else {
        field += ch
      }
    }
    row.push(field.trim())
    result.push(row)
  }
  return result
}

const rows = parseCSV(raw)
if (rows.length < 2) {
  console.error('El CSV no tiene datos.')
  process.exit(1)
}

const headers = rows[0].map(h => h.replace(/^"|"$/g, '').trim())

function col(row, name) {
  const idx = headers.indexOf(name)
  return idx >= 0 ? (row[idx] || '').trim() : ''
}

const insertProvider = db.prepare(`
  INSERT INTO providers (id, name, type, specialty, phone, fax, email, address, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const findProvider = db.prepare(
  `SELECT id FROM providers WHERE name = ? AND (phone = ? OR (phone IS NULL AND ? IS NULL))`
)

let imported = 0
let skipped = 0

for (let i = 1; i < rows.length; i++) {
  const row = rows[i]
  if (row.length < 5) { skipped++; continue }

  const company = col(row, 'Company')
  const firstName = col(row, 'First Name')
  const lastName = col(row, 'Last Name')
  const name = company || [firstName, lastName].filter(Boolean).join(' ')

  if (!name) { skipped++; continue }

  const street = [col(row, 'Business Street'), col(row, 'Business Street 2')]
    .filter(Boolean).join(', ')
  const city = col(row, 'Business City')
  const state = col(row, 'Business State')
  const zip = col(row, 'Business Postal Code')
  const addressParts = [street, city, state, zip].filter(Boolean)
  const address = addressParts.join(', ')

  const phone = col(row, 'Business Phone') || col(row, 'Business Phone 2') || null
  const fax = col(row, 'Business Fax') || null
  const email = col(row, 'E-mail Address') || null
  const specialty = col(row, 'Job Title') || null
  const notes = col(row, 'Notes') || null

  // Verificar si ya existe un provider con mismo nombre y teléfono
  const existing = findProvider.get(name, phone, phone)
  if (existing) {
    skipped++
    console.log(`  - Omitido (ya existe): ${name}`)
    continue
  }

  insertProvider.run(uuidv4(), name, 'Medical Provider', specialty, phone, fax, email, address || null, notes)
  imported++
  console.log(`  ✓ ${name}`)
}

console.log(`\nImportación completa: ${imported} proveedores importados, ${skipped} omitidos.`)

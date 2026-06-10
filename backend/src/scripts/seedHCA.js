#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') })

const { v4: uuidv4 } = require('uuid')
const db = require('../db/schema')

const hcaHospitals = [
  {
    name: 'HCA Florida Kendall Hospital',
    specialty: 'General Acute Care',
    phone: '(305) 223-3000',
    fax: '(305) 223-3215',
    address: '11750 Bird Rd, Miami, FL 33175',
    notes: 'Formerly Kendall Regional Medical Center.',
  },
  {
    name: 'HCA Florida Aventura Hospital',
    specialty: 'General Acute Care',
    phone: '(305) 682-7000',
    fax: '(305) 682-7110',
    address: '20900 Biscayne Blvd, Aventura, FL 33180',
    notes: null,
  },
  {
    name: 'HCA Florida Mercy Hospital',
    specialty: 'General Acute Care',
    phone: '(305) 854-4400',
    fax: '(305) 285-2714',
    address: '3663 S Miami Ave, Miami, FL 33133',
    notes: null,
  },
  {
    name: 'HCA Florida Westside Hospital',
    specialty: 'General Acute Care',
    phone: '(954) 473-6600',
    fax: '(954) 473-6700',
    address: '8201 W Broward Blvd, Plantation, FL 33324',
    notes: null,
  },
  {
    name: 'HCA Florida Northwest Hospital',
    specialty: 'General Acute Care',
    phone: '(954) 978-4000',
    fax: '(954) 978-4200',
    address: '2801 N State Rd 7, Margate, FL 33063',
    notes: null,
  },
  {
    name: 'HCA Florida Palms West Hospital',
    specialty: 'General Acute Care',
    phone: '(561) 798-3300',
    fax: '(561) 798-3400',
    address: '13001 Southern Blvd, Loxahatchee, FL 33470',
    notes: null,
  },
  {
    name: 'HCA Florida St. Lucie Hospital',
    specialty: 'General Acute Care',
    phone: '(772) 335-4000',
    fax: '(772) 335-4100',
    address: '1800 SE Tiffany Ave, Port St. Lucie, FL 34952',
    notes: null,
  },
  {
    name: 'HCA Florida Blake Hospital',
    specialty: 'General Acute Care',
    phone: '(941) 745-2323',
    fax: '(941) 745-2490',
    address: '2020 59th St W, Bradenton, FL 34209',
    notes: null,
  },
  {
    name: 'HCA Florida Brandon Hospital',
    specialty: 'General Acute Care',
    phone: '(813) 681-5551',
    fax: '(813) 661-6700',
    address: '119 Oakfield Dr, Brandon, FL 33511',
    notes: null,
  },
  {
    name: 'HCA Florida South Tampa Hospital',
    specialty: 'General Acute Care',
    phone: '(813) 870-8133',
    fax: '(813) 870-8150',
    address: '2901 W Swann Ave, Tampa, FL 33609',
    notes: null,
  },
  {
    name: 'HCA Florida Trinity Hospital',
    specialty: 'General Acute Care',
    phone: '(727) 834-4000',
    fax: '(727) 834-4100',
    address: '9330 State Rd 54, Trinity, FL 34655',
    notes: null,
  },
  {
    name: 'HCA Florida Oak Hill Hospital',
    specialty: 'General Acute Care',
    phone: '(352) 596-6632',
    fax: '(352) 597-6220',
    address: '11375 Cortez Blvd, Brooksville, FL 34613',
    notes: null,
  },
  {
    name: 'HCA Florida Osceola Hospital',
    specialty: 'Level II Trauma Center',
    phone: '(407) 846-2266',
    fax: '(407) 846-2300',
    address: '700 W Oak St, Kissimmee, FL 34741',
    notes: null,
  },
  {
    name: 'HCA Florida Poinciana Hospital',
    specialty: 'General Acute Care',
    phone: '(407) 530-2000',
    fax: '(407) 530-2100',
    address: '325 Cypress Pkwy, Kissimmee, FL 34759',
    notes: null,
  },
  {
    name: 'HCA Florida North Florida Hospital',
    specialty: 'General Acute Care',
    phone: '(352) 333-4000',
    fax: '(352) 333-4200',
    address: '6500 Newberry Rd, Gainesville, FL 32605',
    notes: null,
  },
  {
    name: 'HCA Florida Lake City Hospital',
    specialty: 'General Acute Care',
    phone: '(386) 719-9000',
    fax: '(386) 719-9100',
    address: '340 NW Commerce Dr, Lake City, FL 32055',
    notes: null,
  },
  {
    name: 'HCA Florida Orange Park Hospital',
    specialty: 'General Acute Care',
    phone: '(904) 276-8500',
    fax: '(904) 276-8600',
    address: '2001 Kingsley Ave, Orange Park, FL 32073',
    notes: null,
  },
  {
    name: 'HCA Florida Gulf Coast Hospital',
    specialty: 'General Acute Care',
    phone: '(850) 769-1511',
    fax: '(850) 747-6400',
    address: '449 W 23rd St, Panama City, FL 32405',
    notes: null,
  },
  {
    name: 'HCA Florida West Florida Hospital',
    specialty: 'General Acute Care',
    phone: '(850) 494-4000',
    fax: '(850) 494-4200',
    address: '8383 N Davis Hwy, Pensacola, FL 32514',
    notes: null,
  },
  {
    name: 'HCA Florida Ocala Hospital',
    specialty: 'General Acute Care',
    phone: '(352) 401-1000',
    fax: '(352) 401-1100',
    address: '1431 SW 1st Ave, Ocala, FL 34471',
    notes: null,
  },
]

const insert = db.prepare(`
  INSERT OR IGNORE INTO providers
    (id, name, type, specialty, phone, fax, email, address, hours, portal_url, notes)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

let inserted = 0
let skipped  = 0

for (const p of hcaHospitals) {
  const exists = db.prepare('SELECT id FROM providers WHERE name = ?').get(p.name)
  if (exists) { skipped++; console.log(`  - Omitido (ya existe): ${p.name}`); continue }

  insert.run(uuidv4(), p.name, 'Hospital', p.specialty, p.phone, p.fax ?? null,
             null, p.address, 'Mon–Fri 8:00am–4:30pm', 'https://www.hcahealthcare.com', p.notes)
  inserted++
  console.log(`  ✓ ${p.name}`)
}

console.log(`\n✅ ${inserted} hospitales HCA insertados, ${skipped} omitidos.`)
process.exit(0)

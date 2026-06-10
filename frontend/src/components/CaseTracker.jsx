import { useState, useEffect, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import api from '../services/api'
import BillingPanel from './BillingPanel'

// ─── Constants ────────────────────────────────────────────────────────────────
const CHECKPOINT_COLORS = {
  c15:   { bg: '#E6F1FB', color: '#0C447C', label: '15-day chk'  },
  c21:   { bg: '#EAF3DE', color: '#27500A', label: '21-day chk'  },
  c99:   { bg: '#FAEEDA', color: '#633806', label: '99-day chk'  },
  c99b:  { bg: '#D3D1C7', color: '#2C2C2A', label: '99-day chk2' },
  fu:    { bg: '#FBEAF0', color: '#72243E', label: 'Follow-up'   },
  qd:    { bg: '#FAECE7', color: '#993C1D', label: 'QD due'      },
  gscdue:{ bg: '#EEEDFE', color: '#3C3489', label: 'GSC due'     },
  bvdue: { bg: '#E1F5EE', color: '#085041', label: 'BV due'      },
}

const DATE_CHECKPOINTS = ['c15','c21','c99','c99b','fu','qd','gscdue','bvdue']

const EXCEL_HEADERS = [
  'Case Number','Created On','Last Name','First Name','Red/ Black','DOL','Open',
  '15 days checkpoint','21 Day checkpoint','99 day checkpoint','99 Day checkpoint2',
  'Migrated','Follow Up','Taskflow','Phase',
  'Quick Demand requested on','QD due date','Global Set Date','Due Date GSC',
  'Routed on','R/B','Notes','BV Email','Due Date','Completed On',
]
const FIELD_KEYS = [
  'num','created','last','first','rb','dol','open',
  'c15','c21','c99','c99b',
  'migrated','fu','taskflow','phase',
  'qd','qddue','gsd','gscdue','routed',
  'urb','notes','bv','bvdue','completed',
]

// ─── Utility Functions ────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str || str === 'False' || str === 'True') return null
  // strip time component
  const datePart = String(str).split(/\s+/)[0]
  const m = datePart.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (!m) return null
  let [, mon, day, yr] = m
  if (yr.length === 2) yr = '20' + yr
  const date = new Date(+yr, +mon - 1, +day)
  if (isNaN(date)) return null
  if (date.getFullYear() < 1950) return null
  return date
}

function formatDate(date) {
  if (!date) return null
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const y = String(date.getFullYear())
  return `${m}/${d}/${y}`
}

function formatDateDash(date) {
  if (!date) return null
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const y = String(date.getFullYear()).slice(2)
  return `${m}-${d}-${y}`
}

function formatDateShort(date) {
  if (!date) return null
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const y = String(date.getFullYear()).slice(2)
  return `${m}/${d}/${y}`
}

function addDays(dateStr, n) {
  const d = parseDate(dateStr)
  if (!d) return null
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

function parsePhase(str) {
  if (!str) return null
  const s = String(str).trim()
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s)
      return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
    } catch { return s }
  }
  return s
}

function isThisWeek(isoString) {
  if (!isoString) return false
  const date = new Date(isoString)
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return date >= monday && date <= sunday
}

function computeDerived(c) {
  const out = { ...c }
  if (c.created) {
    out.c15  = out.c15  || addDays(c.created, 60)
    out.c21  = out.c21  || addDays(c.created, 75)
    out.c99  = out.c99  || addDays(c.created, 99)
    out.c99b = out.c99b || addDays(c.created, 120)
  }
  if (c.qd)  out.qddue  = out.qddue  || addDays(c.qd, 21)
  if (c.gsd) out.gscdue = out.gscdue || addDays(c.gsd, -7)
  if (c.bv)  out.bvdue  = out.bvdue  || addDays(c.bv, 21)
  return out
}

function parseCSV(text) {
  const rows = []
  const lines = []
  let cur = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { inQ = !inQ; cur += ch }
    else if (ch === '\n' && !inQ) { lines.push(cur); cur = '' }
    else { cur += ch }
  }
  if (cur) lines.push(cur)

  const parseRow = (line) => {
    const fields = []
    let f = '', q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (q && line[i+1] === '"') { f += '"'; i++ }
        else q = !q
      } else if (ch === ',' && !q) {
        fields.push(f.trim())
        f = ''
      } else {
        f += ch
      }
    }
    fields.push(f.trim())
    return fields
  }

  if (lines.length < 2) return []
  const headers = parseRow(lines[0]).map(h => h.replace(/^"|"$/g, '').trim())

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const vals = parseRow(lines[i])
    const obj = {}
    headers.forEach((h, idx) => {
      obj[h] = (vals[idx] || '').replace(/^"|"$/g, '').trim()
    })
    rows.push(obj)
  }
  return rows
}

function csvRowToCase(row) {
  const get = (k) => {
    const val = row[k] || ''
    return val.trim() === '' || val === 'False' || val === 'True' ? null : val
  }

  const parseField = (k) => {
    const raw = row[k]
    if (!raw || raw.trim() === '' || raw === 'False' || raw === 'True') return null
    const d = parseDate(raw)
    return d ? formatDate(d) : null
  }

  let num = (row['Case Number'] || '').trim()
  if (/^\d+$/.test(num)) {
    num = 'CASE-' + num.padStart(4, '0')
  }

  const rb = get('Red_Black') || get('RB_Flag') || null
  const phase = parsePhase(get('Phase_Normalized'))

  return {
    num,
    created:  parseField('Created On'),
    last:     get('Last Name'),
    first:    get('First Name'),
    rb,
    dol:      parseField('DOL'),
    open:     parseField('Open'),
    c15:      parseField('15 days checkpoint'),
    c21:      parseField('21 Day checkpoint'),
    c99:      parseField('99 Day checkpoint'),
    c99b:     null,
    migrated: parseField('Migrated'),
    fu:       parseField('Follow Up'),
    taskflow: get('Taskflow'),
    phase,
    qd:       parseField('Quick Demand requested on'),
    qddue:    parseField('QD due date'),
    gsd:      parseField('Global Set Date'),
    gscdue:   parseField('Due Date GSC'),
    routed:   parseField('Routed on'),
    urb:      get('RB'),
    notes:    get('Notes'),
    bv:       parseField('BV Email'),
    bvdue:    parseField('Due Date'),
    completed:parseField('Completed On'),
    addedOn:  new Date().toISOString(),
    source:   'import',
  }
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────
function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1)
  const startOffset = (firstDay.getDay() + 6) % 7 // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const grid = []
  for (let i = 0; i < startOffset; i++) grid.push(null)
  for (let d = 1; d <= daysInMonth; d++) grid.push(d)
  while (grid.length % 7 !== 0) grid.push(null)
  return grid
}

function getEventsForDay(cases, year, month, day) {
  const target = `${String(month+1).padStart(2,'0')}/${String(day).padStart(2,'0')}/${year}`
  const events = []
  for (const c of cases) {
    for (const key of DATE_CHECKPOINTS) {
      if (c[key] === target) {
        events.push({ ...CHECKPOINT_COLORS[key], key, caseNum: c.num, caseName: `${c.last}, ${c.first}` })
      }
    }
  }
  return events
}

function toExcelDate(dateStr) {
  if (!dateStr) return null
  const d = parseDate(dateStr)
  if (!d) return null
  return d
}

// ─── WeeklyBanner ─────────────────────────────────────────────────────────────
function WeeklyBanner({ cases, onExport }) {
  const thisWeekCases = cases.filter(c => isThisWeek(c.added_on || c.addedOn))
  if (thisWeekCases.length === 0) return null
  return (
    <div style={s.banner}>
      <span>📅 <strong>{thisWeekCases.length}</strong> new case{thisWeekCases.length > 1 ? 's' : ''} added this week</span>
      <button style={s.bannerBtn} onClick={onExport}>Export Weekly .xlsx</button>
    </div>
  )
}

// ─── StatsRow ─────────────────────────────────────────────────────────────────
function StatsRow({ cases }) {
  const thisWeek = cases.filter(c => isThisWeek(c.added_on || c.addedOn)).length
  const active   = cases.filter(c => !c.completed).length
  const red      = cases.filter(c => c.rb === 'Red').length
  const black    = cases.filter(c => c.rb === 'Black').length
  const done     = cases.filter(c => !!c.completed).length
  return (
    <div style={s.statsRow}>
      {[
        { label: 'Total Cases', val: cases.length, color: '#a0aec0' },
        { label: 'Active',      val: active,        color: '#63b3ed' },
        { label: 'This Week',   val: thisWeek,      color: '#68d391' },
        { label: 'Red',         val: red,           color: '#fc8181' },
        { label: 'Completed',   val: done,          color: '#9ae6b4' },
      ].map(item => (
        <div key={item.label} style={s.statCard}>
          <div style={{ ...s.statVal, color: item.color }}>{item.val}</div>
          <div style={s.statLabel}>{item.label}</div>
        </div>
      ))}
    </div>
  )
}

// ─── DayDetail ────────────────────────────────────────────────────────────────
function DayDetail({ date, cases, onClose }) {
  if (!date) return null
  const { year, month, day } = date
  const events = getEventsForDay(cases, year, month, day)
  const label = new Date(year, month, day).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
  return (
    <div style={s.dayDetail}>
      <div style={s.dayDetailHeader}>
        <span style={s.dayDetailTitle}>{label}</span>
        <button style={s.closeBtn} onClick={onClose}>✕</button>
      </div>
      {events.length === 0
        ? <div style={s.noEvents}>No checkpoints on this day.</div>
        : events.map((ev, i) => (
          <div key={i} style={{ ...s.eventRow, background: ev.bg, borderLeft: `3px solid ${ev.color}` }}>
            <div style={{ color: ev.color, fontWeight: 600, fontSize: 11 }}>{ev.label}</div>
            <div style={s.eventCase}>{ev.caseNum}</div>
            <div style={s.eventName}>{ev.caseName}</div>
          </div>
        ))
      }
    </div>
  )
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function Calendar({ cases, currentMonth, onDayClick, selectedDate }) {
  const year  = currentMonth.getFullYear()
  const month = currentMonth.getMonth()
  const grid  = getCalendarDays(year, month)
  const days  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

  return (
    <div style={s.calendarWrap}>
      <div style={s.calGrid}>
        {days.map(d => <div key={d} style={s.calDayHeader}>{d}</div>)}
        {grid.map((day, i) => {
          if (!day) return <div key={i} style={s.calCellEmpty} />
          const events = getEventsForDay(cases, year, month, day)
          const isSelected = selectedDate &&
            selectedDate.year === year &&
            selectedDate.month === month &&
            selectedDate.day === day
          const isToday = (() => {
            const t = new Date()
            return t.getFullYear() === year && t.getMonth() === month && t.getDate() === day
          })()
          return (
            <div
              key={i}
              style={{
                ...s.calCell,
                background: isSelected ? '#2d3748' : isToday ? '#1a365d' : '#1e2a3a',
                border: isSelected ? '1px solid #63b3ed' : isToday ? '1px solid #2b6cb0' : '1px solid #2d3748',
                cursor: events.length > 0 ? 'pointer' : 'default',
              }}
              onClick={() => events.length > 0 && onDayClick({ year, month, day })}
            >
              <div style={{ ...s.calDayNum, color: isToday ? '#63b3ed' : '#e2e8f0' }}>{day}</div>
              <div style={s.pillWrap}>
                {events.slice(0, 3).map((ev, j) => (
                  <div key={j} style={{ ...s.pill, background: ev.bg, color: ev.color }}>
                    {ev.label}
                  </div>
                ))}
                {events.length > 3 && (
                  <div style={s.moreEvents}>+{events.length - 3} more</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── NewCaseModal ─────────────────────────────────────────────────────────────
const EMPTY_CASE = () => ({
  num:'', created:'', last:'', first:'', rb:'', dol:'', open:'',
  c15:'', c21:'', c99:'', c99b:'',
  migrated:'', fu:'', taskflow:'', phase:'',
  qd:'', qddue:'', gsd:'', gscdue:'', routed:'',
  urb:'', notes:'', bv:'', bvdue:'', completed:'',
})

function NewCaseModal({ onSave, onClose, existingNums }) {
  const [form, setForm] = useState(EMPTY_CASE())
  const [error, setError] = useState('')

  const set = (k, v) => {
    setForm(prev => {
      const next = { ...prev, [k]: v }
      // Auto-derive when trigger fields change
      if (k === 'created') {
        if (!prev.c15)  next.c15  = addDays(v, 60)  || ''
        if (!prev.c21)  next.c21  = addDays(v, 75)  || ''
        if (!prev.c99)  next.c99  = addDays(v, 99)  || ''
        if (!prev.c99b) next.c99b = addDays(v, 120) || ''
      }
      if (k === 'qd')  next.qddue  = addDays(v, 21)  || ''
      if (k === 'gsd') next.gscdue = addDays(v, -7)  || ''
      if (k === 'bv')  next.bvdue  = addDays(v, 21)  || ''
      return next
    })
  }

  const handleSave = () => {
    if (!form.num.trim()) return setError('Case number is required.')
    if (existingNums.includes(form.num.trim())) return setError('Case number already exists.')
    setError('')
    onSave({ ...form, num: form.num.trim(), addedOn: new Date().toISOString(), source: 'manual' })
  }

  const Field = ({ label, k, type='text', auto=false }) => (
    <div style={s.formField}>
      <label style={s.formLabel}>{label}{auto && <span style={s.autoBadge}>auto</span>}</label>
      <input
        style={{ ...s.formInput, background: auto ? '#16213e' : '#1e2a3a' }}
        type={type}
        value={form[k]}
        placeholder={type === 'date' ? 'MM/DD/YYYY' : ''}
        onChange={e => set(k, e.target.value)}
      />
    </div>
  )

  const DateField = ({ label, k, auto=false }) => (
    <div style={s.formField}>
      <label style={s.formLabel}>{label}{auto && <span style={s.autoBadge}>auto</span>}</label>
      <input
        style={{ ...s.formInput, background: auto ? '#16213e' : '#1e2a3a' }}
        type="text"
        placeholder="MM/DD/YYYY"
        value={form[k]}
        onChange={e => set(k, e.target.value)}
      />
    </div>
  )

  return (
    <div style={s.modalOverlay}>
      <div style={s.modalBox}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>New Case</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          {error && <div style={s.errorBanner}>{error}</div>}
          <div style={s.formGrid}>
            <Field label="Case Number *" k="num" />
            <DateField label="Created On" k="created" />
            <Field label="Last Name" k="last" />
            <Field label="First Name" k="first" />
            <div style={s.formField}>
              <label style={s.formLabel}>Red / Black</label>
              <select style={s.formSelect} value={form.rb} onChange={e => set('rb', e.target.value)}>
                <option value="">—</option>
                <option>Red</option>
                <option>Black</option>
              </select>
            </div>
            <DateField label="DOL" k="dol" />
            <DateField label="Open" k="open" />
            <DateField label="15-day chk (Created+60)" k="c15" auto />
            <DateField label="21-day chk (Created+75)" k="c21" auto />
            <DateField label="99-day chk (Created+99)" k="c99" auto />
            <DateField label="99-day chk2 (Created+120)" k="c99b" auto />
            <DateField label="Migrated" k="migrated" />
            <DateField label="Follow Up" k="fu" />
            <Field label="Taskflow" k="taskflow" />
            <Field label="Phase" k="phase" />
            <DateField label="Quick Demand requested on" k="qd" />
            <DateField label="QD due date (QD+21)" k="qddue" auto />
            <DateField label="Global Set Date" k="gsd" />
            <DateField label="Due Date GSC (GSD-7)" k="gscdue" auto />
            <DateField label="Routed on" k="routed" />
            <Field label="R/B (col U)" k="urb" />
            <DateField label="BV Email" k="bv" />
            <DateField label="Due Date (BV+21)" k="bvdue" auto />
            <DateField label="Completed On" k="completed" />
            <div style={{ ...s.formField, gridColumn: '1 / -1' }}>
              <label style={s.formLabel}>Notes</label>
              <textarea
                style={{ ...s.formInput, height: 60, resize: 'vertical' }}
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
              />
            </div>
          </div>
        </div>
        <div style={s.modalFooter}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.saveBtn} onClick={handleSave}>Save Case</button>
        </div>
      </div>
    </div>
  )
}

// ─── ImportCSVModal ───────────────────────────────────────────────────────────
function ImportCSVModal({ onImport, onClose, existingNums }) {
  const [preview, setPreview] = useState([])
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef()

  const parseFile = (file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const rows = parseCSV(text)
      const cases = rows.map(csvRowToCase).filter(c => c.num)
      setPreview(cases)
    }
    reader.readAsText(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) parseFile(file)
  }

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (file) parseFile(file)
  }

  const handleImport = () => {
    const toImport = preview.filter(c => !existingNums.includes(c.num))
    onImport(toImport)
  }

  const dupeCount = preview.filter(c => existingNums.includes(c.num)).length

  return (
    <div style={s.modalOverlay}>
      <div style={{ ...s.modalBox, maxWidth: 900 }}>
        <div style={s.modalHeader}>
          <span style={s.modalTitle}>Import CSV</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div style={s.modalBody}>
          {preview.length === 0 ? (
            <div
              style={{
                ...s.dropZone,
                borderColor: dragging ? '#63b3ed' : '#2d3748',
                background: dragging ? '#1a365d' : '#1e2a3a',
              }}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current.click()}
            >
              <div style={s.dropIcon}>📂</div>
              <div style={s.dropText}>Drop CSV file here, or click to browse</div>
              <div style={s.dropHint}>Accepts the firm's standard export format</div>
              <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }} onChange={handleFile} />
            </div>
          ) : (
            <>
              <div style={s.previewInfo}>
                {preview.length} rows parsed
                {dupeCount > 0 && <span style={s.dupeWarning}> · {dupeCount} duplicate(s) will be skipped</span>}
              </div>
              <div style={s.previewWrap}>
                <table style={s.previewTable}>
                  <thead>
                    <tr>
                      {['#','Case Number','Last','First','Created','DOL','Phase','Status'].map(h => (
                        <th key={h} style={s.previewTh}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((c, i) => {
                      const isDupe = existingNums.includes(c.num)
                      return (
                        <tr key={i} style={{ opacity: isDupe ? 0.4 : 1 }}>
                          <td style={s.previewTd}>{i + 1}</td>
                          <td style={s.previewTd}>{c.num}</td>
                          <td style={s.previewTd}>{c.last}</td>
                          <td style={s.previewTd}>{c.first}</td>
                          <td style={s.previewTd}>{c.created}</td>
                          <td style={s.previewTd}>{c.dol}</td>
                          <td style={s.previewTd}>{c.phase}</td>
                          <td style={{ ...s.previewTd, color: isDupe ? '#fc8181' : '#68d391' }}>
                            {isDupe ? 'SKIP' : 'NEW'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div style={s.modalFooter}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          {preview.length > 0 && (
            <>
              <button style={s.cancelBtn} onClick={() => setPreview([])}>Clear</button>
              <button style={s.saveBtn} onClick={handleImport}>
                Import {preview.length - dupeCount} Cases
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── CaseList ─────────────────────────────────────────────────────────────────
function CaseList({ cases, onDelete, onBilling }) {
  const [search, setSearch] = useState('')
  const filtered = search
    ? cases.filter(c =>
        `${c.num} ${c.last} ${c.first} ${c.phase}`.toLowerCase().includes(search.toLowerCase())
      )
    : cases

  return (
    <div style={s.listWrap}>
      <input
        style={s.searchInput}
        placeholder="Search cases..."
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div style={s.listScroll}>
        <table style={s.listTable}>
          <thead>
            <tr>
              {['Case #','Last','First','Created','DOL','Phase','R/B','15-chk','Completed',''].map(h => (
                <th key={h} style={s.listTh}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => (
              <tr key={c.num} style={{ background: i % 2 === 0 ? '#1e2a3a' : '#1a2535' }}>
                <td style={s.listTd}><span style={s.caseNum}>{c.num}</span></td>
                <td style={s.listTd}>{c.last}</td>
                <td style={s.listTd}>{c.first}</td>
                <td style={s.listTd}>{c.created}</td>
                <td style={s.listTd}>{c.dol}</td>
                <td style={s.listTd}>{c.phase}</td>
                <td style={s.listTd}>
                  {c.rb && (
                    <span style={{ color: c.rb === 'Red' ? '#fc8181' : '#a0aec0', fontWeight: 600 }}>
                      {c.rb}
                    </span>
                  )}
                </td>
                <td style={s.listTd}>{c.c15}</td>
                <td style={s.listTd}>{c.completed ? <span style={{ color: '#68d391' }}>✓</span> : ''}</td>
                <td style={s.listTd}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button style={s.billingBtn} onClick={() => onBilling(c)} title="Billing Calculator">
                      $
                    </button>
                    <button style={s.deleteBtn} onClick={() => onDelete(c.num)}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={s.noEvents}>No cases found.</div>}
      </div>
    </div>
  )
}

// ─── Main CaseTracker ─────────────────────────────────────────────────────────
export default function CaseTracker() {
  const [cases, setCases]             = useState([])
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(null)
  const [showNewCase, setShowNewCase] = useState(false)
  const [showImport, setShowImport]   = useState(false)
  const [view, setView]               = useState('calendar') // 'calendar' | 'list'
  const [loading, setLoading]         = useState(true)
  const [billingCase, setBillingCase] = useState(null) // case row for BillingPanel

  // ── Load cases ──────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/cases')
      .then(r => { setCases(r.data); setLoading(false) })
      .catch(() => {
        // Fallback to localStorage if backend fails
        try {
          const saved = localStorage.getItem('kp_cases')
          if (saved) setCases(JSON.parse(saved))
        } catch {}
        setLoading(false)
      })
  }, [])

  const persistCases = (updated) => {
    setCases(updated)
    localStorage.setItem('kp_cases', JSON.stringify(updated))
  }

  // ── Save single case ────────────────────────────────────────────────
  const handleSaveCase = async (caseObj) => {
    const derived = computeDerived(caseObj)
    try {
      await api.post('/cases', derived)
    } catch {}
    persistCases([derived, ...cases])
    setShowNewCase(false)
  }

  // ── Import cases ────────────────────────────────────────────────────
  const handleImport = async (rows) => {
    try {
      await api.post('/cases/import', rows)
    } catch {}
    const existingNums = cases.map(c => c.num)
    const newCases = rows.filter(r => !existingNums.includes(r.num))
    persistCases([...newCases, ...cases])
    setShowImport(false)
  }

  // ── Delete case ─────────────────────────────────────────────────────
  const handleDelete = async (num) => {
    if (!window.confirm(`Delete case ${num}?`)) return
    try {
      await api.delete(`/cases/${encodeURIComponent(num)}`)
    } catch {}
    persistCases(cases.filter(c => c.num !== num))
  }

  // ── Export weekly XLSX ──────────────────────────────────────────────
  const handleExport = () => {
    const now = new Date()
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    const fmt = (d) => {
      const m = String(d.getMonth()+1).padStart(2,'0')
      const dd = String(d.getDate()).padStart(2,'0')
      const y = d.getFullYear()
      return `${m}-${dd}-${y}`
    }

    const wb = XLSX.utils.book_new()

    // Row 1: constants
    const row1 = Array(25).fill(null)
    const excelDateNum = (d) => {
      if (!d) return null
      const date = parseDate(d)
      if (!date) return null
      // Excel serial (days since 1900-01-01, with leap year bug)
      const start = new Date(Date.UTC(1900, 0, 1))
      const ms = date.getTime() - start.getTime()
      return Math.floor(ms / 86400000) + 2
    }

    // A1 = TODAY() — we'll write as a date value
    row1[0]  = new Date()
    row1[6]  = 14   // G1
    row1[7]  = 60   // H1
    row1[8]  = 75   // I1
    row1[9]  = 99   // J1
    row1[10] = 120  // K1
    row1[15] = 21   // P1
    row1[18] = 7    // S1
    row1[19] = 20   // T1
    row1[21] = 'check the health lien on all of them' // V1
    row1[22] = 21   // W1

    // Row 2: headers
    const row2 = EXCEL_HEADERS

    // Data rows
    const dataRows = cases.map(c => {
      const dateVal = (str) => {
        if (!str) return null
        const d = parseDate(str)
        return d || null
      }
      return [
        c.num,
        dateVal(c.created),
        c.last,
        c.first,
        c.rb,
        dateVal(c.dol),       // col F → mm-dd-yy
        dateVal(c.open),
        dateVal(c.c15),
        dateVal(c.c21),
        dateVal(c.c99),
        dateVal(c.c99b),
        dateVal(c.migrated),
        dateVal(c.fu),
        c.taskflow,
        c.phase,
        dateVal(c.qd),
        dateVal(c.qddue),
        dateVal(c.gsd),
        dateVal(c.gscdue),
        dateVal(c.routed),
        c.urb,
        c.notes,
        dateVal(c.bv),
        dateVal(c.bvdue),
        dateVal(c.completed),
      ]
    })

    const sheetData = [row1, row2, ...dataRows]
    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    // Apply date formats
    const dateColsExceptF = [1,6,7,8,9,10,11,12,15,16,17,18,19,22,23,24] // B,G,H,I,J,K,L,M,P,Q,R,S,T,W,X,Y (0-indexed)
    const dolCol = 5 // F
    const numFmt_mmddyy = 'mm/dd/yy'
    const numFmt_dol    = 'mm-dd-yy'

    if (!ws['!cols']) ws['!cols'] = Array(25).fill({ wch: 14 })

    for (let r = 2; r < sheetData.length; r++) {
      const rowIdx = r + 1
      for (const col of dateColsExceptF) {
        const cell = XLSX.utils.encode_cell({ r, c: col })
        if (ws[cell] && ws[cell].v instanceof Date) {
          ws[cell].t = 'd'
          ws[cell].z = numFmt_mmddyy
        }
      }
      const dolCell = XLSX.utils.encode_cell({ r, c: dolCol })
      if (ws[dolCell] && ws[dolCell].v instanceof Date) {
        ws[dolCell].t = 'd'
        ws[dolCell].z = numFmt_dol
      }
    }

    // A1 as date
    if (ws['A1']) { ws['A1'].t = 'd'; ws['A1'].z = numFmt_mmddyy }

    XLSX.utils.book_append_sheet(wb, ws, 'Cases')

    const filename = `Cases_Week_${fmt(monday)}_to_${fmt(sunday)}.xlsx`
    XLSX.writeFile(wb, filename)
  }

  // ── Month navigation ────────────────────────────────────────────────
  const prevMonth = () => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth()-1, 1))
  const nextMonth = () => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth()+1, 1))

  const monthLabel = currentMonth.toLocaleDateString('en-US', { month:'long', year:'numeric' })
  const existingNums = cases.map(c => c.num)

  if (loading) return <div style={s.loading}>Loading cases…</div>

  return (
    <div style={s.container}>
      {/* Weekly banner */}
      <WeeklyBanner cases={cases} onExport={handleExport} />

      {/* Stats */}
      <StatsRow cases={cases} />

      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={s.toolbarLeft}>
          {view === 'calendar' && (
            <>
              <button style={s.navBtn} onClick={prevMonth}>‹</button>
              <span style={s.monthLabel}>{monthLabel}</span>
              <button style={s.navBtn} onClick={nextMonth}>›</button>
            </>
          )}
        </div>
        <div style={s.toolbarRight}>
          <div style={s.viewToggle}>
            <button
              style={view === 'calendar' ? s.viewActive : s.viewInactive}
              onClick={() => setView('calendar')}
            >📅 Calendar</button>
            <button
              style={view === 'list' ? s.viewActive : s.viewInactive}
              onClick={() => setView('list')}
            >☰ List</button>
          </div>
          <button style={s.importBtn} onClick={() => setShowImport(true)}>⬆ Import CSV</button>
          <button style={s.newBtn} onClick={() => setShowNewCase(true)}>+ New Case</button>
          <button style={s.exportBtn} onClick={handleExport}>⬇ Export .xlsx</button>
        </div>
      </div>

      {/* Main content */}
      <div style={s.mainContent}>
        {view === 'calendar' ? (
          <>
            <Calendar
              cases={cases}
              currentMonth={currentMonth}
              selectedDate={selectedDate}
              onDayClick={setSelectedDate}
            />
            {selectedDate && (
              <DayDetail
                date={selectedDate}
                cases={cases}
                onClose={() => setSelectedDate(null)}
              />
            )}
          </>
        ) : (
          <CaseList cases={cases} onDelete={handleDelete} onBilling={setBillingCase} />
        )}
      </div>

      {/* Modals */}
      {showNewCase && (
        <NewCaseModal
          onSave={handleSaveCase}
          onClose={() => setShowNewCase(false)}
          existingNums={existingNums}
        />
      )}
      {showImport && (
        <ImportCSVModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
          existingNums={existingNums}
        />
      )}
      {billingCase && (
        <BillingPanel
          caseData={billingCase}
          onClose={() => setBillingCase(null)}
        />
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#1a1a2e',
    color: '#e2e8f0',
    overflow: 'hidden',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  loading: { padding: 40, textAlign: 'center', color: '#718096' },

  // Banner
  banner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: '#1a365d', borderBottom: '1px solid #2b6cb0',
    padding: '8px 16px', fontSize: 13, color: '#bee3f8',
  },
  bannerBtn: {
    padding: '5px 14px', borderRadius: 6, border: 'none',
    background: '#2b6cb0', color: '#fff', fontSize: 12, cursor: 'pointer',
  },

  // Stats
  statsRow: { display: 'flex', gap: 8, padding: '8px 12px' },
  statCard: {
    flex: 1, background: '#16213e', borderRadius: 8,
    padding: '8px 12px', textAlign: 'center',
  },
  statVal: { fontSize: 22, fontWeight: 700 },
  statLabel: { fontSize: 11, color: '#718096', marginTop: 2 },

  // Toolbar
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', borderBottom: '1px solid #2d3748',
  },
  toolbarLeft:  { display: 'flex', alignItems: 'center', gap: 8 },
  toolbarRight: { display: 'flex', alignItems: 'center', gap: 8 },
  navBtn: {
    width: 28, height: 28, borderRadius: 6, border: 'none',
    background: '#2d3748', color: '#e2e8f0', fontSize: 16, cursor: 'pointer',
  },
  monthLabel: { fontSize: 15, fontWeight: 600, minWidth: 160, textAlign: 'center' },
  viewToggle: { display: 'flex', background: '#16213e', borderRadius: 6, padding: 2 },
  viewActive: {
    padding: '4px 12px', borderRadius: 5, border: 'none',
    background: '#3182ce', color: '#fff', fontSize: 12, cursor: 'pointer',
  },
  viewInactive: {
    padding: '4px 12px', borderRadius: 5, border: 'none',
    background: 'transparent', color: '#718096', fontSize: 12, cursor: 'pointer',
  },
  importBtn: {
    padding: '5px 12px', borderRadius: 6, border: 'none',
    background: '#2d3748', color: '#a0aec0', fontSize: 12, cursor: 'pointer',
  },
  newBtn: {
    padding: '5px 14px', borderRadius: 6, border: 'none',
    background: '#38a169', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  exportBtn: {
    padding: '5px 12px', borderRadius: 6, border: 'none',
    background: '#2d3748', color: '#68d391', fontSize: 12, cursor: 'pointer',
  },

  // Main
  mainContent: {
    display: 'flex', flex: 1, overflow: 'hidden', gap: 8, padding: 8,
  },

  // Calendar
  calendarWrap: { flex: 1, overflow: 'auto' },
  calGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4, minWidth: 700,
  },
  calDayHeader: {
    textAlign: 'center', padding: '6px 0',
    fontSize: 11, fontWeight: 600, color: '#718096',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  calCellEmpty: { minHeight: 90 },
  calCell: {
    minHeight: 90, borderRadius: 6, padding: 6,
    display: 'flex', flexDirection: 'column', transition: 'border-color .15s',
  },
  calDayNum: { fontSize: 13, fontWeight: 600, marginBottom: 4 },
  pillWrap: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  pill: {
    fontSize: 9, fontWeight: 600, padding: '2px 5px',
    borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  moreEvents: { fontSize: 9, color: '#718096', marginTop: 2 },

  // DayDetail
  dayDetail: {
    width: 280, flexShrink: 0, background: '#16213e',
    borderRadius: 10, border: '1px solid #2d3748', overflow: 'auto',
    padding: 12,
  },
  dayDetailHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 12,
  },
  dayDetailTitle: { fontSize: 13, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.3 },
  noEvents: { color: '#718096', fontSize: 13, textAlign: 'center', padding: '20px 0' },
  eventRow: {
    borderRadius: 6, padding: '8px 10px', marginBottom: 6,
  },
  eventCase: { fontSize: 11, fontWeight: 600, color: '#e2e8f0', marginTop: 2 },
  eventName: { fontSize: 11, color: '#a0aec0' },

  // CaseList
  listWrap: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  searchInput: {
    padding: '7px 12px', borderRadius: 6, border: '1px solid #2d3748',
    background: '#1e2a3a', color: '#e2e8f0', fontSize: 13, marginBottom: 8,
    outline: 'none',
  },
  listScroll: { flex: 1, overflow: 'auto' },
  listTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  listTh: {
    textAlign: 'left', padding: '6px 10px', position: 'sticky', top: 0,
    background: '#16213e', color: '#718096', fontWeight: 600,
    borderBottom: '1px solid #2d3748',
  },
  listTd: { padding: '6px 10px', color: '#e2e8f0' },
  caseNum: { fontFamily: 'monospace', color: '#63b3ed', fontWeight: 600 },
  deleteBtn: {
    background: 'none', border: 'none', color: '#fc8181',
    cursor: 'pointer', fontSize: 12, padding: '2px 6px',
  },
  billingBtn: {
    background: '#1a365d', border: '1px solid #2b6cb0',
    color: '#63b3ed', cursor: 'pointer', fontSize: 12,
    padding: '2px 7px', borderRadius: 4, fontWeight: 700,
  },

  // Modals
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modalBox: {
    background: '#16213e', borderRadius: 12, border: '1px solid #2d3748',
    width: '90%', maxWidth: 700, maxHeight: '90vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 18px', borderBottom: '1px solid #2d3748',
  },
  modalTitle: { fontWeight: 700, fontSize: 16 },
  closeBtn: {
    background: 'none', border: 'none', color: '#718096',
    fontSize: 16, cursor: 'pointer', padding: '2px 6px',
  },
  modalBody: { padding: 18, overflow: 'auto', flex: 1 },
  modalFooter: {
    padding: '12px 18px', borderTop: '1px solid #2d3748',
    display: 'flex', gap: 8, justifyContent: 'flex-end',
  },
  cancelBtn: {
    padding: '7px 16px', borderRadius: 6, border: '1px solid #2d3748',
    background: 'transparent', color: '#a0aec0', fontSize: 13, cursor: 'pointer',
  },
  saveBtn: {
    padding: '7px 16px', borderRadius: 6, border: 'none',
    background: '#38a169', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },

  // Form
  formGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px',
  },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  formLabel: { fontSize: 11, color: '#a0aec0', fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' },
  autoBadge: {
    fontSize: 9, background: '#2b6cb0', color: '#bee3f8',
    padding: '1px 5px', borderRadius: 3, fontWeight: 600,
  },
  formInput: {
    padding: '6px 10px', borderRadius: 6, border: '1px solid #2d3748',
    color: '#e2e8f0', fontSize: 13, outline: 'none',
    width: '100%', boxSizing: 'border-box',
  },
  formSelect: {
    padding: '6px 10px', borderRadius: 6, border: '1px solid #2d3748',
    background: '#1e2a3a', color: '#e2e8f0', fontSize: 13, outline: 'none',
    width: '100%',
  },
  errorBanner: {
    background: '#742a2a', border: '1px solid #c53030', borderRadius: 6,
    padding: '8px 12px', marginBottom: 12, fontSize: 13, color: '#feb2b2',
  },

  // Drop zone
  dropZone: {
    border: '2px dashed', borderRadius: 10,
    padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
    transition: 'all .2s',
  },
  dropIcon: { fontSize: 36, marginBottom: 8 },
  dropText: { fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 },
  dropHint: { fontSize: 12, color: '#718096' },

  // Preview table
  previewInfo: { fontSize: 13, color: '#a0aec0', marginBottom: 10 },
  dupeWarning: { color: '#fc8181' },
  previewWrap: { overflow: 'auto', maxHeight: 400 },
  previewTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  previewTh: {
    textAlign: 'left', padding: '6px 10px', position: 'sticky', top: 0,
    background: '#0f3460', color: '#a0aec0', fontWeight: 600,
    borderBottom: '1px solid #2d3748',
  },
  previewTd: { padding: '5px 10px', borderBottom: '1px solid #1e2a3a', color: '#e2e8f0' },
}

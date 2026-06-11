import { useMemo } from 'react'

const fmt = (n) => {
  const num = parseFloat(n) || 0
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const moneyInput = (value, onChange) => (
  <input
    type="number"
    step="0.01"
    min="0"
    value={value}
    onChange={onChange}
    style={s.numInput}
  />
)

// ── Soft info notice (confidence ≥ 0.60 but has issues) ───────────────────────
function InfoNotice({ issues }) {
  if (!issues.length) return null
  return (
    <div style={s.infoNotice}>
      <span style={s.infoIcon}>ℹ</span>
      <ul style={s.infoList}>
        {issues.map((issue, i) => <li key={i}>{issue}</li>)}
      </ul>
    </div>
  )
}

// ── AI Banner ──────────────────────────────────────────────────────────────────
function AIBanner({ issues, aiLoading, onUseAI, onDismiss }) {
  return (
    <div style={s.banner}>
      <div style={s.bannerTop}>
        <span style={s.bannerTitle}>Some data could not be verified</span>
        <div style={s.bannerBtns}>
          {aiLoading ? (
            <span style={s.bannerLoading}>Querying AI…</span>
          ) : (
            <>
              <button style={s.bannerBtnAI} onClick={onUseAI}>Use AI</button>
              <button style={s.bannerBtnDismiss} onClick={onDismiss}>Continue manually</button>
            </>
          )}
        </div>
      </div>
      {issues.length > 0 && (
        <ul style={s.bannerList}>
          {issues.map((issue, i) => <li key={i}>{issue}</li>)}
        </ul>
      )}
    </div>
  )
}

// ── Main Calculator ────────────────────────────────────────────────────────────
export default function BillingCalculator({
  claims,
  confidence,
  confidenceIssues,
  bannerDismissed,
  aiLoading,
  aiUsed,
  usedOcr,
  mlUsed,
  mlLoading,
  onClaimChange,
  onUseAI,
  onForceMl,
  onDismissBanner,
  onSave,
  saving,
}) {
  const showBanner  = confidence !== null && confidence < 0.35 && !bannerDismissed && !aiUsed
  const showNotice  = confidence !== null && confidence >= 0.35 && confidenceIssues.length > 0 && !aiUsed
  const showGmBadge = aiUsed || (confidence !== null && confidence < 0.35)

  // Totals recalculate from editable claims state
  const totals = useMemo(() => {
    if (!claims.length) return null
    const t = { totalCharges: 0, totalAdjustments: 0, pipPaid: 0, healthPaid: 0, patientPaid: 0 }
    for (const c of claims) {
      t.totalCharges     += parseFloat(c.charge)      || 0
      t.totalAdjustments += parseFloat(c.adjustments) || 0
      t.pipPaid          += parseFloat(c.pipPaid)     || 0
      t.healthPaid       += parseFloat(c.healthPaid)  || 0
      t.patientPaid      += parseFloat(c.patientPaid) || 0
    }
    t.outstanding = t.totalCharges - t.totalAdjustments - t.pipPaid - t.healthPaid - t.patientPaid
    for (const k of Object.keys(t)) t[k] = parseFloat(t[k].toFixed(2))
    return t
  }, [claims])

  // No file analyzed yet
  if (!claims.length && confidence === null) {
    return (
      <div style={s.empty}>
        <span style={s.emptyIcon}>📊</span>
        <p style={s.emptyTitle}>Select a billing document</p>
        <p style={s.emptyHint}>Load the PDF on the left panel to start analysis</p>
      </div>
    )
  }

  // File was analyzed but 0 claims found — still allow AI escalation
  if (!claims.length) {
    return (
      <div style={s.container}>
        {showBanner && (
          <AIBanner
            issues={confidenceIssues}
            aiLoading={aiLoading}
            onUseAI={onUseAI}
            onDismiss={onDismissBanner}
          />
        )}
        <div style={s.empty}>
          <span style={s.emptyIcon}>🔍</span>
          <p style={s.emptyTitle}>Format not recognized</p>
          <p style={s.emptyHint}>
            {showBanner
              ? 'The local parser found no claims. Use AI to extract the data.'
              : 'Verify the PDF is a billing document from Athena or a standard charges summary.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={s.container}>

      {/* Orange banner — confidence < 0.35, suggests AI */}
      {showBanner && (
        <AIBanner
          issues={confidenceIssues}
          aiLoading={aiLoading}
          onUseAI={onUseAI}
          onDismiss={onDismissBanner}
        />
      )}

      {/* Blue info notice — confidence OK but has soft warnings */}
      {showNotice && <InfoNotice issues={confidenceIssues} />}

      {/* Confidence + OCR + ML + GM badges + Try ML button */}
      <div style={s.metaRow}>
        {confidence !== null && (
          <span style={{ ...s.badge, background: confidence >= 0.35 ? '#0d3021' : '#3d1f00', color: confidence >= 0.35 ? '#68d391' : '#f6ad55' }}>
            {Math.round(confidence * 100)}% confidence
          </span>
        )}
        {mlUsed && (
          <span title="ML-NER model was used to extract fields" style={{ ...s.badge, background: '#1a2640', color: '#76e4f7', fontWeight: 700, letterSpacing: '0.04em' }}>
            ML
          </span>
        )}
        {showGmBadge && (
          <span title={aiUsed ? 'Gemini AI was used' : 'Gemini recommended — confidence too low'} style={{ ...s.badge, background: aiUsed ? '#2d1a40' : '#3d2200', color: aiUsed ? '#b794f4' : '#f6ad55', fontWeight: 700, letterSpacing: '0.04em' }}>
            GM
          </span>
        )}
        {usedOcr && <span style={{ ...s.badge, background: '#1a2840', color: '#63b3ed' }}>OCR</span>}
        {!mlUsed && !aiUsed && confidence !== null && (
          <button
            onClick={onForceMl}
            disabled={mlLoading}
            title="Run ML-NER model manually on this document"
            style={s.mlBtn}
          >
            {mlLoading ? '...' : 'Try ML'}
          </button>
        )}
      </div>

      {/* Claims table */}
      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              {['Claim ID', 'Charge', 'Adj.', 'PIP', 'Health Ins.', 'Patient', 'Lien'].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {claims.map((claim, idx) => {
              const lien = (
                (parseFloat(claim.charge)      || 0) -
                (parseFloat(claim.adjustments) || 0) -
                (parseFloat(claim.pipPaid)     || 0) -
                (parseFloat(claim.healthPaid)  || 0) -
                (parseFloat(claim.patientPaid) || 0)
              )
              const lienColor = lien > 0.01 ? '#fc8181' : lien < -0.01 ? '#f6ad55' : '#68d391'
              const set = (field) => (e) => onClaimChange(idx, field, e.target.value)
              return (
                <tr key={claim.claimId} style={{ background: idx % 2 === 0 ? '#1e2a3a' : '#192334' }}>
                  <td style={{ ...s.td, color: '#63b3ed', fontFamily: 'monospace', fontWeight: 600 }}>
                    {claim.claimId}
                  </td>
                  <td style={s.td}>{moneyInput(claim.charge,      set('charge'))}</td>
                  <td style={s.td}>{moneyInput(claim.adjustments, set('adjustments'))}</td>
                  <td style={s.td}>{moneyInput(claim.pipPaid,     set('pipPaid'))}</td>
                  <td style={s.td}>{moneyInput(claim.healthPaid,  set('healthPaid'))}</td>
                  <td style={s.td}>{moneyInput(claim.patientPaid, set('patientPaid'))}</td>
                  <td style={{ ...s.td, color: lienColor, fontWeight: 700, fontFamily: 'monospace' }}>
                    ${fmt(lien)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Totals summary */}
      {totals && (
        <div style={s.totalsCard}>
          <div style={s.totalsTitle}>Summary</div>
          <div style={s.totalsGrid}>
            <TotalRow label="Total Charges"         value={totals.totalCharges}     color="#e2e8f0" />
            <TotalRow label="Contractual Adj."       value={totals.totalAdjustments} color="#fc8181" prefix="-" />
            <TotalRow label="PIP Paid"              value={totals.pipPaid}          color="#68d391"  prefix="-" />
            <TotalRow label="Health Insurance"      value={totals.healthPaid}       color="#63b3ed"  prefix="-" />
            <TotalRow label="Patient"               value={totals.patientPaid}      color="#b794f4"  prefix="-" />
            <div style={s.totalsDivider} />
            <TotalRow
              label="Outstanding / Lien"
              value={totals.outstanding}
              color={totals.outstanding > 0.01 ? '#fc8181' : '#68d391'}
              bold
            />
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        style={s.saveBtn}
        onClick={onSave}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save billing summary'}
      </button>
    </div>
  )
}

function TotalRow({ label, value, color, prefix = '', bold = false }) {
  return (
    <div style={s.totalRow}>
      <span style={{ ...s.totalLabel, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ ...s.totalValue, color, fontWeight: bold ? 700 : 600 }}>
        {prefix}${fmt(value)}
      </span>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  container: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    overflowY: 'auto',
    padding: '0 4px',
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: '#4a5568',
    padding: '2rem',
  },
  emptyIcon:  { fontSize: 36 },
  emptyTitle: { color: '#718096', margin: 0, fontSize: 14, fontWeight: 600 },
  emptyHint:  { color: '#4a5568', margin: 0, fontSize: 12, textAlign: 'center' },

  // AI Banner
  banner: {
    background: '#2d1f00',
    border: '1px solid #744210',
    borderRadius: 6,
    padding: '10px 14px',
    flexShrink: 0,
  },
  bannerTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  bannerTitle:   { color: '#f6ad55', fontWeight: 600, fontSize: 13 },
  bannerBtns:    { display: 'flex', gap: 6, flexShrink: 0 },
  bannerLoading: { color: '#f6ad55', fontSize: 12 },
  bannerBtnAI: {
    padding: '4px 12px', borderRadius: 4, border: 'none',
    background: '#c05621', color: '#fff', fontSize: 12,
    fontWeight: 600, cursor: 'pointer',
  },
  bannerBtnDismiss: {
    padding: '4px 10px', borderRadius: 4,
    border: '1px solid #744210', background: 'transparent',
    color: '#a0aec0', fontSize: 12, cursor: 'pointer',
  },
  bannerList: {
    margin: '8px 0 0 0',
    paddingLeft: 18,
    color: '#cbd5e0',
    fontSize: 11,
    lineHeight: 1.6,
  },

  metaRow: { display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' },
  mlBtn: {
    padding: '2px 8px', borderRadius: 4,
    border: '1px solid #2c5282', background: 'transparent',
    color: '#76e4f7', fontSize: 11, cursor: 'pointer',
    fontWeight: 600, letterSpacing: '0.03em',
    opacity: 1, transition: 'opacity 0.15s',
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
  },

  // Table
  tableWrap: { flex: 1, overflow: 'auto', borderRadius: 6, border: '1px solid #2d3748' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'right',
    padding: '7px 8px',
    position: 'sticky', top: 0,
    background: '#16213e',
    color: '#718096',
    fontWeight: 600,
    borderBottom: '1px solid #2d3748',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '4px 6px',
    color: '#e2e8f0',
    textAlign: 'right',
    borderBottom: '1px solid #1a2535',
  },
  numInput: {
    width: 90,
    padding: '4px 6px',
    borderRadius: 4,
    border: '1px solid #2d3748',
    background: '#243447',
    color: '#F5F0E8',
    fontSize: 12,
    textAlign: 'right',
    outline: 'none',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
  },

  // Totals
  totalsCard: {
    background: '#16213e',
    borderRadius: 6,
    border: '1px solid #2d3748',
    padding: '12px 16px',
    flexShrink: 0,
  },
  totalsTitle: {
    color: '#a0aec0',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  totalsGrid: { display: 'flex', flexDirection: 'column', gap: 6 },
  totalRow:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: '#a0aec0', fontSize: 13 },
  totalValue: { fontSize: 14, fontFamily: 'monospace' },
  totalsDivider: { height: 1, background: '#2d3748', margin: '4px 0' },

  saveBtn: {
    width: '100%',
    padding: '10px',
    borderRadius: 6,
    border: 'none',
    background: '#2b6cb0',
    color: '#fff',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
    letterSpacing: '0.04em',
  },

  // Soft info notice (blue)
  infoNotice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    background: '#1a2840',
    border: '1px solid #2b6cb0',
    borderRadius: 6,
    padding: '8px 12px',
    flexShrink: 0,
  },
  infoIcon: {
    color: '#63b3ed',
    fontWeight: 700,
    fontSize: 13,
    flexShrink: 0,
    marginTop: 1,
  },
  infoList: {
    margin: 0,
    paddingLeft: 14,
    color: '#90cdf4',
    fontSize: 11,
    lineHeight: 1.6,
  },
}

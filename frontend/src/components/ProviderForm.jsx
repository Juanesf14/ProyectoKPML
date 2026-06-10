import { useState, useEffect } from 'react'
import api from '../services/api'


export default function ProviderForm({ provider, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: '',
    type: 'Medical Provider',
    specialty: '',
    phone: '',
    fax: '',
    email: '',
    address: '',
    hours: '',
    portal_url: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (provider) setForm({
      name:       provider.name       || '',
      type:       provider.type       || 'hospital',
      specialty:  provider.specialty  || '',
      phone:      provider.phone      || '',
      fax:        provider.fax        || '',
      email:      provider.email      || '',
      address:    provider.address    || '',
      hours:      provider.hours      || '',
      portal_url: provider.portal_url || '',
      notes:      provider.notes      || '',
    })
  }, [provider])

  const handleChange = e => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (provider) {
        await api.put(`/providers/${provider.id}`, form)
      } else {
        await api.post('/providers', form)
      }
      onSave()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h3 style={styles.title}>
          {provider ? 'Edit Provider' : 'New Provider'}
        </h3>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>Name *</label>
              <input
                style={styles.input}
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                placeholder="St. Mary Hospital"
              />
            </div>
           <div style={styles.field}>
                <label style={styles.label}>Category *</label>
                <select name="type" value={form.type} onChange={handleChange} style={styles.input}>
                    <option value="Medical Provider">Medical Provider</option>
                    <option value="Insurance">Insurance</option>
                    <option value="Legal">Legal</option>
                </select>
                </div>
          </div>

          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>Phone</label>
              <input style={styles.input} name="phone" value={form.phone} onChange={handleChange} placeholder="(555) 000-0000" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Fax</label>
              <input style={styles.input} name="fax" value={form.fax} onChange={handleChange} placeholder="(555) 000-0000" />
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input style={styles.input} name="email" type="email" value={form.email} onChange={handleChange} placeholder="contact@hospital.com" />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Address</label>
            <input style={styles.input} name="address" value={form.address} onChange={handleChange} placeholder="123 Main St, City, ST 00000" />
          </div>

          <div style={styles.row}>
            <div style={styles.field}>
              <label style={styles.label}>Business Hours</label>
              <input style={styles.input} name="hours" value={form.hours} onChange={handleChange} placeholder="Open 24 hours" />
            </div>
             </div>
        <div style={styles.field}>
            <label style={styles.label}>Specialty</label>
            <select name="specialty" value={form.specialty} onChange={handleChange} style={styles.input}>
                            <option value="">Select...</option>
                <option>Acupuncture</option>
                <option>Ambulance</option>
                <option>Anesthesia</option>
                <option>Cardiologist</option>
                <option>Chemotherapy</option>
                <option>Chiropractic</option>
                <option>COVID Test</option>
                <option>CT Scan</option>
                <option>Dentist</option>
                <option>Diagnostic Studies</option>
                <option>Emergency Room Treatment</option>
                <option>Fusion</option>
                <option>Home Visit</option>
                <option>Hospital Admission</option>
                <option>Hospital Visit</option>
                <option>Injections</option>
                <option>Intensive Care Unit</option>
                <option>Mammography</option>
                <option>Medical Equipment</option>
                <option>MRI</option>
                <option>Neurologist</option>
                <option>Nursing Home Stay</option>
                <option>OBGYN</option>
                <option>Occupational Therapy</option>
                <option>Outpatient Clinic</option>
                <option>Pain Management</option>
                <option>Pathology</option>
                <option>Pharmacy</option>
                <option>Physical Therapy</option>
                <option>Plastic Surgeon</option>
                <option>Podiatrist</option>
                <option>Post Op</option>
                <option>Pre-Op</option>
                <option>Primary Care Physician</option>
                <option>Psychiatric</option>
                <option>Psychological</option>
                <option>Radiology</option>
                <option>Rehabilitation</option>
                <option>Surgery</option>
                <option>Surgery Recommendation</option>
                <option>Telemedicine</option>
                <option>Ultrasound</option>
                <option>Urgent Care</option>
                <option>X-Ray</option>
            </select>
            </div>

          <div style={styles.field}>
            <label style={styles.label}>Portal URL</label>
            <input style={styles.input} name="portal_url" value={form.portal_url} onChange={handleChange} placeholder="https://portal.hospital.com" />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Notes</label>
            <textarea
              style={{ ...styles.input, height: 70, resize: 'none' }}
              name="notes"
              value={form.notes}
              onChange={handleChange}
              placeholder="Additional information..."
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <div style={styles.actions}>
            <button type="button" style={styles.btnCancel} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" style={styles.btnSave} disabled={loading}>
              {loading ? 'Saving...' : provider ? 'Save changes' : 'Add provider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#16213e',
    borderRadius: 12,
    padding: '1.5rem',
    width: 520,
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  title: {
    color: '#e2e8f0',
    margin: '0 0 1rem 0',
    fontSize: 16,
    fontWeight: 700,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 10 },
  row: { display: 'flex', gap: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 },
  label: { color: '#a0aec0', fontSize: 12 },
  input: {
    padding: '7px 10px',
    borderRadius: 6,
    border: '1px solid #2d3748',
    background: '#0f3460',
    color: '#e2e8f0',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  error: { color: '#fc8181', fontSize: 13, margin: 0 },
  actions: { display: 'flex', gap: 10, marginTop: 8 },
  btnCancel: {
    flex: 1,
    padding: '9px',
    borderRadius: 8,
    border: '1px solid #2d3748',
    background: 'transparent',
    color: '#a0aec0',
    fontSize: 14,
    cursor: 'pointer',
  },
  btnSave: {
    flex: 1,
    padding: '9px',
    borderRadius: 8,
    border: 'none',
    background: '#e94560',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
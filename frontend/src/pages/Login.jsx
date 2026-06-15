import { useState, useEffect } from 'react'
import api from '../services/api'

export default function Login({ onLogin }) {
  // 'login' | 'bootstrap' — bootstrap shows on a fresh install with no users yet.
  const [mode, setMode] = useState('login')
  const [checking, setChecking] = useState(true)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // On load, ask the backend whether this install still needs its first admin.
  useEffect(() => {
    api.get('/auth/status')
      .then(({ data }) => setMode(data.needsBootstrap ? 'bootstrap' : 'login'))
      .catch(() => setMode('login'))
      .finally(() => setChecking(false))
  }, [])

  const isBootstrap = mode === 'bootstrap'
  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value })

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = isBootstrap ? '/auth/bootstrap' : '/auth/login'
      const payload = isBootstrap ? form : { email: form.email, password: form.password }
      const { data } = await api.post(endpoint, payload)
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      onLogin(data.user)
    } catch (err) {
      const raw = err.response?.data?.error || ''
      if (raw === 'Invalid credentials') {
        setError('Wrong email or password. Please try again.')
      } else if (raw) {
        setError(raw)
      } else {
        setError('Connection error — make sure the app backend is running.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.subtitle}>Loading…</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>K&P · RenamerJF</h1>
        <p style={styles.subtitle}>Medical Records Manager</p>

        {isBootstrap && (
          <div style={styles.bootstrapNote}>
            First-time setup — create the administrator account for this computer.
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {isBootstrap && (
            <input
              style={styles.input}
              name="name"
              placeholder="Full name"
              value={form.name}
              onChange={handleChange}
              required
            />
          )}
          <input
            style={styles.input}
            name="email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={handleChange}
            required
          />
          <input
            style={styles.input}
            name="password"
            type="password"
            placeholder={isBootstrap ? 'Password (min. 8 characters)' : 'Password'}
            value={form.password}
            onChange={handleChange}
            required
          />
          {error && (
            <div style={styles.errorBanner}>
              <span style={styles.errorIcon}>⚠</span>
              <span>{error}</span>
            </div>
          )}
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Loading...' : isBootstrap ? 'Create administrator' : 'Sign in'}
          </button>
        </form>

        {!isBootstrap && (
          <p style={styles.toggle}>
            Forgot your password? Ask an administrator to reset it.
          </p>
        )}
      </div>
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0D1B2A',
  },
  card: {
    background: '#1B2D42',
    borderRadius: 4,
    padding: '2.5rem',
    width: 380,
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    borderTop: '3px solid #C9A84C',
  },
  title: {
    color: '#C9A84C',
    margin: 0,
    fontSize: 30,
    fontWeight: 700,
    textAlign: 'center',
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    letterSpacing: '0.04em',
  },
  subtitle: {
    color: '#8B95A1',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 32,
    fontSize: 12,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  input: {
    padding: '10px 14px',
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: '#243447',
    color: '#F5F0E8',
    fontSize: 14,
    outline: 'none',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  button: {
    marginTop: 8,
    padding: '11px',
    borderRadius: 3,
    border: 'none',
    background: '#C9A84C',
    color: '#0D1B2A',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  errorBanner: {
    background: 'rgba(252, 129, 129, 0.08)',
    border: '1px solid rgba(252, 129, 129, 0.35)',
    borderRadius: 3,
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#fc8181',
    fontSize: 13,
    lineHeight: 1.4,
  },
  errorIcon: {
    fontSize: 15,
    flexShrink: 0,
  },
  toggle: {
    color: '#556270',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 13,
  },
  bootstrapNote: {
    background: 'rgba(201, 168, 76, 0.10)',
    border: '1px solid rgba(201, 168, 76, 0.35)',
    borderRadius: 3,
    padding: '10px 14px',
    color: '#C9A84C',
    fontSize: 12.5,
    lineHeight: 1.45,
    marginBottom: 16,
    textAlign: 'center',
  },
  link: {
    color: '#C9A84C',
    cursor: 'pointer',
    fontWeight: 600,
  },
}
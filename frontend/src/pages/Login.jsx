import { useState } from 'react'
import api from '../services/api'

export default function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value })

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login'
      const payload = isRegister ? form : { email: form.email, password: form.password }
      const { data } = await api.post(endpoint, payload)
      localStorage.setItem('token', data.token)
      localStorage.setItem('user', JSON.stringify(data.user))
      onLogin(data.user)
    } catch (err) {
      // Map generic backend messages to user-friendly text.
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

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>K&P · RenamerJF</h1>
        <p style={styles.subtitle}>Medical Records Manager</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          {isRegister && (
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
            placeholder="Password"
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
            {loading ? 'Loading...' : isRegister ? 'Sign up' : 'Sign in'}
          </button>
        </form>
        <p style={styles.toggle}>
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <span style={styles.link} onClick={() => setIsRegister(!isRegister)}>
            {isRegister ? 'Sign in' : 'Sign up'}
          </span>
        </p>
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
  link: {
    color: '#C9A84C',
    cursor: 'pointer',
    fontWeight: 600,
  },
}
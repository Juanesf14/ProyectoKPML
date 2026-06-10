import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
})

// Attach the JWT from localStorage to every outgoing request.
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// On 401, force a full reload ONLY when the user had an active session
// (i.e. a token exists). This handles expired or revoked tokens.
// When there is no token the user is on the login screen — propagate the
// error normally so the login form can display the "wrong password" banner.
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.reload()
    }
    return Promise.reject(err)
  }
)

export default api
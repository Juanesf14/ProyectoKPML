// Hermetic env MUST be set before requiring the app (it reads these at load).
const os   = require('node:os')
const path = require('node:path')
const fs   = require('node:fs')

const TMP_DB = path.join(os.tmpdir(), `kp-api-test-${process.pid}.db`)
process.env.PORT        = '39517'
process.env.DB_PATH     = TMP_DB
process.env.JWT_SECRET  = 'test-secret'
// Block any SEED_* coming from a real .env so the DB starts empty (bootstrap path).
for (const k of ['NAME', 'EMAIL', 'PASSWORD']) {
  process.env[`SEED_ADMIN_${k}`] = ''
  process.env[`SEED_USER_${k}`]  = ''
  process.env[`SEED_USER2_${k}`] = ''
}

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')

const { server } = require('../src/index')
const BASE = `http://127.0.0.1:${process.env.PORT}`

let token

const post = (p, body, tok) =>
  fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify(body),
  })
const get = (p, tok) =>
  fetch(`${BASE}${p}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })

before(async () => {
  if (!server.listening) await once(server, 'listening')
})

after(() => {
  server.close()
  fs.rmSync(TMP_DB, { force: true })
})

test('fresh install needs bootstrap', async () => {
  const res = await get('/api/auth/status')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).needsBootstrap, true)
})

test('bootstrap creates the first admin and returns a token', async () => {
  const res = await post('/api/auth/bootstrap', {
    name: 'Admin', email: 'admin@test.com', password: 'password123',
  })
  assert.equal(res.status, 201)
  const data = await res.json()
  assert.ok(data.token)
  assert.equal(data.user.role, 'admin')
  token = data.token
})

test('bootstrap is blocked once a user exists', async () => {
  const res = await post('/api/auth/bootstrap', {
    name: 'X', email: 'x@test.com', password: 'password123',
  })
  assert.equal(res.status, 403)
})

test('login rejects wrong password', async () => {
  const res = await post('/api/auth/login', { email: 'admin@test.com', password: 'wrong' })
  assert.equal(res.status, 401)
})

test('login succeeds with correct credentials', async () => {
  const res = await post('/api/auth/login', { email: 'admin@test.com', password: 'password123' })
  assert.equal(res.status, 200)
  assert.ok((await res.json()).token)
})

test('helmet security header is present', async () => {
  const res = await get('/api/auth/status')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})

test('cases endpoint requires a token', async () => {
  const res = await get('/api/cases')
  assert.equal(res.status, 401)
})

test('cases endpoint works with a token', async () => {
  const res = await get('/api/cases', token)
  assert.equal(res.status, 200)
  assert.ok(Array.isArray(await res.json()))
})

test('history report aggregates repeated providers', async () => {
  // Record three renames: HCA x2, Mercy x1.
  for (let i = 0; i < 2; i++) {
    await post('/api/history', {
      original_name: `a${i}.pdf`, new_name: 'Bills-HCA.pdf', entity_name: 'HCA Hospital',
    }, token)
  }
  await post('/api/history', {
    original_name: 'm.pdf', new_name: 'Records-Mercy.pdf', entity_name: 'Mercy Hospital',
  }, token)

  const res = await get('/api/history/report', token)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.total, 3)
  const hca = data.providers.find(p => p.provider === 'HCA Hospital')
  assert.equal(hca.count, 2)
})

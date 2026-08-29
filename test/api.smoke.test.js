import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js')
const PORT = 8799
const BASE_URL = `http://127.0.0.1:${PORT}`

let child
let workDir

function waitForServer(proc, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout esperando al servidor')), timeoutMs)

    function onData(buffer) {
      if (buffer.toString().includes('VensuR API activa')) {
        cleanup()
        resolve()
      }
    }

    function onExit(code) {
      cleanup()
      reject(new Error(`El servidor termino antes de iniciar (code ${code})`))
    }

    function cleanup() {
      clearTimeout(timer)
      proc.stdout.off('data', onData)
      proc.off('exit', onExit)
    }

    proc.stdout.on('data', onData)
    proc.once('exit', onExit)
  })
}

before(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'vensur-test-'))

  child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BOTS_ENABLED: 'false',
      API_PORT: String(PORT),
      DB_PATH: path.join(workDir, 'test.db'),
      UPLOADS_DIR: path.join(workDir, 'uploads'),
      AUTH_JWT_SECRET: 'test-secret-para-suite-de-humo-1234567890',
      AUTH_RATE_LIMIT_MAX: '5',
      AUTH_RATE_LIMIT_WINDOW_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await waitForServer(child)
})

after(() => {
  if (child && !child.killed) child.kill('SIGKILL')
  if (workDir) {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

test('GET /api/health responde ok', async () => {
  const res = await fetch(`${BASE_URL}/api/health`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
})

test('las rutas protegidas exigen sesion', async () => {
  const res = await fetch(`${BASE_URL}/api/auth/me`)
  assert.equal(res.status, 401)
})

test('reaccionar a un post exige sesion', async () => {
  const res = await fetch(`${BASE_URL}/api/content/posts/abc/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: 1 }),
  })
  assert.equal(res.status, 401)
})

test('registro -> verificacion -> login -> reaccion persistente', async () => {
  const email = `tester_${Date.now()}@vensur.test`
  const username = `tester${Date.now().toString().slice(-8)}`

  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, displayName: 'Tester', password: 'clave-super-segura' }),
  })
  assert.equal(registerRes.status, 201)
  const registerBody = await registerRes.json()
  assert.equal(registerBody.requiresEmailVerification, true)
  assert.match(String(registerBody.debugVerificationCode), /^\d{6}$/)

  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: registerBody.debugVerificationCode }),
  })
  assert.equal(verifyRes.status, 200)
  const verifyBody = await verifyRes.json()
  const token = verifyBody.token
  assert.ok(token)

  // Crear un post propio.
  const form = new FormData()
  form.append('caption', 'Post de prueba')
  form.append('location', 'Caracas')
  const postRes = await fetch(`${BASE_URL}/api/content/me/posts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  assert.equal(postRes.status, 201)
  const { post } = await postRes.json()
  assert.ok(post.id)

  // Dar like y comprobar que el contador y el estado quedan bien.
  const likeRes = await fetch(`${BASE_URL}/api/content/posts/${post.id}/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ delta: 1 }),
  })
  assert.equal(likeRes.status, 200)
  const likeBody = await likeRes.json()
  assert.equal(likeBody.liked, true)
  assert.equal(likeBody.post.reactions, 1)
  assert.equal(likeBody.post.likedByViewer, true)

  // Idempotencia: un segundo like no incrementa.
  const likeAgain = await fetch(`${BASE_URL}/api/content/posts/${post.id}/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ delta: 1 }),
  })
  const likeAgainBody = await likeAgain.json()
  assert.equal(likeAgainBody.post.reactions, 1)

  // El feed devuelve likedByViewer para la sesion.
  const feedRes = await fetch(`${BASE_URL}/api/content/posts`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const feedBody = await feedRes.json()
  const mine = feedBody.items.find((item) => item.id === post.id)
  assert.equal(mine.likedByViewer, true)

  // Quitar el like.
  const unlikeRes = await fetch(`${BASE_URL}/api/content/posts/${post.id}/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ delta: -1 }),
  })
  const unlikeBody = await unlikeRes.json()
  assert.equal(unlikeBody.liked, false)
  assert.equal(unlikeBody.post.reactions, 0)
})

test('el rate limiter de /api/auth responde 429 tras varios intentos', async () => {
  const attempts = []
  for (let index = 0; index < 9; index += 1) {
    attempts.push(
      fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'no@existe.test', password: 'x' }),
      }).then((res) => res.status),
    )
  }

  const statuses = await Promise.all(attempts)
  assert.ok(statuses.includes(429), `esperaba un 429 en ${statuses.join(',')}`)
})

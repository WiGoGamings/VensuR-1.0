import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { authenticator as totpAuthenticator } from 'otplib'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js')
const PORT = 8799
const BASE_URL = `http://127.0.0.1:${PORT}`

let child
let workDir

function readSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie()
  }

  const rawCookie = response.headers.get('set-cookie')
  return rawCookie ? [rawCookie] : []
}

function applySetCookies(cookieJar, setCookieHeaders) {
  for (const cookieHeader of setCookieHeaders) {
    const [nameValue] = String(cookieHeader).split(';')
    const separator = nameValue.indexOf('=')
    if (separator <= 0) continue

    const name = nameValue.slice(0, separator).trim()
    const value = nameValue.slice(separator + 1).trim()
    cookieJar.set(name, value)
  }
}

function toCookieHeader(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
      AUTH_LOGIN_FAIL_WINDOW_MS: '60000',
      AUTH_LOGIN_LOCK_L1_AFTER: '3',
      AUTH_LOGIN_LOCK_L1_MS: '1500',
      AUTH_LOGIN_LOCK_L2_AFTER: '6',
      AUTH_LOGIN_LOCK_L2_MS: '4000',
      AUTH_LOGIN_LOCK_L3_AFTER: '9',
      AUTH_LOGIN_LOCK_L3_MS: '9000',
      SECURITY_AUDIT_ADMIN_ALLOWLIST: 'auditoradmin',
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
      fetch(`${BASE_URL}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `noexiste-${index}@vensur.test` }),
      }).then((res) => res.status),
    )
  }

  const statuses = await Promise.all(attempts)
  assert.ok(statuses.includes(429), `esperaba un 429 en ${statuses.join(',')}`)
})

test('login aplica bloqueo progresivo tras fallos repetidos', async () => {
  await new Promise((resolve) => setTimeout(resolve, 2_100))

  const baseIdentifier = `bloqueo_${Date.now()}@vensur.test`

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: baseIdentifier, password: 'clave-incorrecta' }),
    })
    assert.equal(res.status, 401)
  }

  const thresholdHitRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: baseIdentifier, password: 'clave-incorrecta' }),
  })

  assert.equal(thresholdHitRes.status, 429)
  const retryAfterThreshold = Number(thresholdHitRes.headers.get('retry-after') || '0')
  assert.ok(retryAfterThreshold >= 1)

  const blockedRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: baseIdentifier, password: 'clave-incorrecta' }),
  })

  assert.equal(blockedRes.status, 429)
  const retryAfter = Number(blockedRes.headers.get('retry-after') || '0')
  assert.ok(retryAfter >= 1)

  const blockedBody = await blockedRes.json()
  assert.match(String(blockedBody.error || ''), /demasiados intentos/i)
})

test('sesion por cookies: refresh rota y el replay invalida la familia', async () => {
  // El rate limiter de auth se comparte por IP en esta suite; esperamos a que
  // expire la ventana para aislar este caso de prueba.
  await new Promise((resolve) => setTimeout(resolve, 2_100))

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const email = `cookies_${stamp}@vensur.test`
  const username = `cookies${stamp}`.slice(0, 20)
  const cookieJar = new Map()

  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, displayName: 'Cookies Tester', password: 'clave-super-segura' }),
  })
  assert.equal(registerRes.status, 201)
  const registerBody = await registerRes.json()

  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: registerBody.debugVerificationCode }),
  })
  assert.equal(verifyRes.status, 200)

  applySetCookies(cookieJar, readSetCookies(verifyRes))
  assert.ok(cookieJar.has('vensur_access'))
  assert.ok(cookieJar.has('vensur_refresh'))

  const staleCookieHeader = toCookieHeader(cookieJar)

  const meWithCookie = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: {
      Cookie: toCookieHeader(cookieJar),
    },
  })
  assert.equal(meWithCookie.status, 200)

  const refreshOk = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: toCookieHeader(cookieJar),
    },
  })
  assert.equal(refreshOk.status, 200)

  applySetCookies(cookieJar, readSetCookies(refreshOk))
  const rotatedCookieHeader = toCookieHeader(cookieJar)
  assert.notEqual(rotatedCookieHeader, staleCookieHeader)

  const replayAttempt = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: staleCookieHeader,
    },
  })
  assert.equal(replayAttempt.status, 401)

  const familyRevoked = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: toCookieHeader(cookieJar),
    },
  })
  assert.equal(familyRevoked.status, 401)
})

test('MFA TOTP: setup, activacion y desafio de login', async () => {
  await wait(2_100)

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const email = `mfa_${stamp}@vensur.test`
  const username = `mfa${stamp}`.slice(0, 20)

  const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, displayName: 'MFA Tester', password: 'clave-super-segura' }),
  })
  assert.equal(registerRes.status, 201)
  const registerBody = await registerRes.json()

  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: registerBody.debugVerificationCode }),
  })
  assert.equal(verifyRes.status, 200)
  const verifyBody = await verifyRes.json()
  const authToken = verifyBody.token
  assert.ok(authToken)

  const setupRes = await fetch(`${BASE_URL}/api/auth/mfa/setup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  })
  assert.equal(setupRes.status, 200)
  const setupBody = await setupRes.json()
  assert.ok(setupBody.setupToken)
  assert.ok(setupBody.secret)
  assert.match(String(setupBody.otpauthUrl || ''), /^otpauth:\/\//i)

  const enableCode = totpAuthenticator.generate(setupBody.secret)
  const enableRes = await fetch(`${BASE_URL}/api/auth/mfa/enable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ setupToken: setupBody.setupToken, code: enableCode }),
  })
  assert.equal(enableRes.status, 200)
  const enableBody = await enableRes.json()
  assert.equal(enableBody.user.mfaEnabled, true)

  await wait(2_100)

  let loginRes
  for (let attempt = 0; attempt < 4; attempt += 1) {
    loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: email, password: 'clave-super-segura' }),
    })

    if (loginRes.status !== 429) break
    const retryAfter = Number(loginRes.headers.get('retry-after') || '1')
    await wait(Math.max(1_000, retryAfter * 1000 + 250))
  }

  assert.ok(loginRes)
  assert.equal(loginRes.status, 401)
  const loginBody = await loginRes.json()
  assert.equal(loginBody.errorCode, 'MFA_REQUIRED')
  assert.ok(loginBody.mfaToken)

  await wait(2_100)

  const verifyMfaCode = totpAuthenticator.generate(setupBody.secret)
  let verifyMfaRes
  for (let attempt = 0; attempt < 4; attempt += 1) {
    verifyMfaRes = await fetch(`${BASE_URL}/api/auth/mfa/verify-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: loginBody.mfaToken, code: verifyMfaCode }),
    })

    if (verifyMfaRes.status !== 429) break
    const retryAfter = Number(verifyMfaRes.headers.get('retry-after') || '1')
    await wait(Math.max(1_000, retryAfter * 1000 + 250))
  }

  assert.ok(verifyMfaRes)
  assert.equal(verifyMfaRes.status, 200)
  const verifyMfaBody = await verifyMfaRes.json()
  assert.equal(verifyMfaBody.user.mfaEnabled, true)
})

test('auditoria de seguridad: admin allowlist puede leer y usuario normal no', async () => {
  await wait(2_100)

  const adminEmail = `auditoradmin@vensur.test`
  const adminUsername = 'auditoradmin'

  const adminRegister = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: adminEmail,
      username: adminUsername,
      displayName: 'Auditor Admin',
      password: 'clave-super-segura',
    }),
  })
  assert.equal(adminRegister.status, 201)
  const adminRegisterBody = await adminRegister.json()

  const adminVerify = await fetch(`${BASE_URL}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, code: adminRegisterBody.debugVerificationCode }),
  })
  assert.equal(adminVerify.status, 200)
  const adminVerifyBody = await adminVerify.json()
  const adminToken = adminVerifyBody.token
  assert.ok(adminToken)

  const auditOk = await fetch(`${BASE_URL}/api/security/audit-events?limit=5&days=7`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  })
  assert.equal(auditOk.status, 200)
  const auditBody = await auditOk.json()
  assert.ok(Array.isArray(auditBody.items))

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const userEmail = `normal_${stamp}@vensur.test`
  const userUsername = `normal${stamp}`.slice(0, 20)

  const userRegister = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: userEmail,
      username: userUsername,
      displayName: 'Normal User',
      password: 'clave-super-segura',
    }),
  })
  assert.equal(userRegister.status, 201)
  const userRegisterBody = await userRegister.json()

  const userVerify = await fetch(`${BASE_URL}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: userEmail, code: userRegisterBody.debugVerificationCode }),
  })
  assert.equal(userVerify.status, 200)
  const userVerifyBody = await userVerify.json()
  const userToken = userVerifyBody.token
  assert.ok(userToken)

  const auditDenied = await fetch(`${BASE_URL}/api/security/audit-events?limit=5&days=7`, {
    headers: {
      Authorization: `Bearer ${userToken}`,
    },
  })
  assert.equal(auditDenied.status, 403)
})

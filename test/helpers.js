import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js')

/**
 * Arranca una instancia aislada de la API (BD y uploads temporales, bots apagados).
 * @param {number} port
 * @param {Record<string,string>} [extraEnv]
 */
export async function startTestServer(port, extraEnv = {}) {
  const workDir = mkdtempSync(path.join(tmpdir(), 'vensur-test-'))

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BOTS_ENABLED: 'false',
      MAIL_TRANSPORT: 'console',
      API_PORT: String(port),
      DB_PATH: path.join(workDir, 'test.db'),
      UPLOADS_DIR: path.join(workDir, 'uploads'),
      AUTH_JWT_SECRET: 'test-secret-para-suite-de-humo-1234567890',
      AUTH_RATE_LIMIT_MAX: '500',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout esperando al servidor')), 15_000)

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
      child.stdout.off('data', onData)
      child.off('exit', onExit)
    }

    child.stdout.on('data', onData)
    child.once('exit', onExit)
  })

  const baseUrl = `http://127.0.0.1:${port}`

  return {
    baseUrl,
    async stop() {
      if (!child.killed) child.kill('SIGKILL')
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        // best effort
      }
    },
  }
}

/**
 * Registra + verifica una cuenta y devuelve su token y datos basicos.
 * @param {string} baseUrl
 * @param {{ visibility?: 'public' | 'private' }} [options]
 */
export async function createVerifiedUser(baseUrl, options = {}) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const email = `u_${stamp}@vensur.test`
  const username = `u${stamp}`.slice(0, 20)

  const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, displayName: `User ${stamp}`, password: 'clave-super-segura' }),
  })
  const registerBody = await registerRes.json()

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: registerBody.debugVerificationCode }),
  })
  const verifyBody = await verifyRes.json()
  const token = verifyBody.token

  if (options.visibility) {
    await fetch(`${baseUrl}/api/auth/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ profileVisibility: options.visibility }),
    })
  }

  return { email, username, token, user: verifyBody.user }
}

export function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

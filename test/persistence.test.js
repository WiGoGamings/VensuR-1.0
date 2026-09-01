import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'index.js')

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

async function startServer({ port, dbPath, uploadsDir }) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      BOTS_ENABLED: 'false',
      API_PORT: String(port),
      DB_PATH: dbPath,
      UPLOADS_DIR: uploadsDir,
      AUTH_JWT_SECRET: 'test-secret-para-persistencia-1234567890',
      AUTH_RATE_LIMIT_MAX: '500',
      AUTH_EXPOSE_VERIFICATION_CODE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await waitForServer(child)

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop() {
      if (!child.killed) {
        child.kill('SIGKILL')
      }

      await new Promise((resolve) => {
        if (child.exitCode !== null || child.killed) {
          resolve()
          return
        }

        child.once('exit', () => resolve())
      })
    },
  }
}

test('la cuenta registrada persiste entre reinicios cuando DB_PATH se mantiene', async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'vensur-persist-'))
  const dbPath = path.join(workDir, 'persist.db')
  const uploadsDir = path.join(workDir, 'uploads')
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const email = `persist_${stamp}@vensur.test`
  const username = `persist${stamp}`.slice(0, 20)
  const password = 'ClavePersistente123!'

  let server = null

  try {
    server = await startServer({ port: 8812, dbPath, uploadsDir })

    const registerRes = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        username,
        displayName: 'Persistencia Test',
        password,
      }),
    })

    assert.equal(registerRes.status, 201)
    const registerBody = await registerRes.json()
    assert.match(String(registerBody.debugVerificationCode), /^\d{6}$/)

    const verifyRes = await fetch(`${server.baseUrl}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        code: registerBody.debugVerificationCode,
      }),
    })

    assert.equal(verifyRes.status, 200)
    await server.stop()

    server = await startServer({ port: 8813, dbPath, uploadsDir })

    const loginRes = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: email,
        password,
      }),
    })

    assert.equal(loginRes.status, 200)
    const loginBody = await loginRes.json()
    assert.ok(loginBody.token)
    assert.equal(loginBody.user.email, email)
    assert.equal(loginBody.user.username, username)
  } finally {
    if (server) {
      await server.stop().catch(() => {})
    }

    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
})

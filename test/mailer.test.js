import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

test('transporte "file" escribe el correo con el codigo', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vensur-mail-'))
  process.env.MAIL_TRANSPORT = 'file'
  process.env.MAIL_OUTBOX_DIR = dir
  process.env.MAIL_FROM = 'VensuR Test <test@vensur.local>'

  // import dinamico para que lea la config ya ajustada.
  const { sendVerificationEmail } = await import('../server/lib/mailer.js')

  try {
    const result = await sendVerificationEmail({ email: 'destino@vensur.test', displayName: 'Ada' }, '123456')
    assert.equal(result.delivered, true)
    assert.equal(result.transport, 'file')

    const files = readdirSync(dir)
    assert.equal(files.length, 1)

    const saved = JSON.parse(readFileSync(path.join(dir, files[0]), 'utf8'))
    assert.equal(saved.to, 'destino@vensur.test')
    assert.equal(saved.from, 'VensuR Test <test@vensur.local>')
    assert.ok(saved.text.includes('123456'))
    assert.ok(saved.html.includes('123456'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.MAIL_TRANSPORT
    delete process.env.MAIL_OUTBOX_DIR
    delete process.env.MAIL_FROM
  }
})

test('transporte "console" no lanza y reporta entrega', async () => {
  process.env.MAIL_TRANSPORT = 'console'
  const { sendMail } = await import('../server/lib/mailer.js')

  const result = await sendMail({ to: 'x@y.z', subject: 'hola', text: 'cuerpo' })
  assert.equal(result.delivered, true)
  assert.equal(result.transport, 'console')

  delete process.env.MAIL_TRANSPORT
})

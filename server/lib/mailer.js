import { appendFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'

/**
 * Envio de correo con transportes intercambiables y sin dependencias obligatorias.
 *
 * MAIL_TRANSPORT:
 *   - "console" (por defecto): imprime el correo en stdout. Ideal para desarrollo.
 *   - "file": escribe cada correo como JSON en MAIL_OUTBOX_DIR (server/outbox por defecto).
 *   - "smtp": usa "nodemailer" (npm i nodemailer). Config por SMTP_URL o SMTP_HOST/PORT/USER/PASS.
 *
 * MAIL_FROM: remitente, p. ej. "VensuR <no-reply@tudominio.com>".
 */

function readConfig() {
  return {
    transport: (process.env.MAIL_TRANSPORT || 'console').trim().toLowerCase(),
    from: process.env.MAIL_FROM || 'VensuR <no-reply@vensur.local>',
    outboxDir: process.env.MAIL_OUTBOX_DIR || path.join(process.cwd(), 'server', 'outbox'),
  }
}

let smtpTransportPromise = null

async function getSmtpTransport() {
  if (!smtpTransportPromise) {
    smtpTransportPromise = (async () => {
      let nodemailer
      try {
        nodemailer = (await import('nodemailer')).default
      } catch {
        throw new Error(
          'MAIL_TRANSPORT=smtp requiere el paquete "nodemailer". Instala con: npm i nodemailer',
        )
      }

      const url = process.env.SMTP_URL
      if (url) return nodemailer.createTransport(url)

      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number.parseInt(process.env.SMTP_PORT ?? '587', 10) || 587,
        secure: String(process.env.SMTP_SECURE ?? '').trim().toLowerCase() === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      })
    })()
  }

  return smtpTransportPromise
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} message
 * @returns {Promise<{ delivered: boolean, transport: string, id?: string, path?: string }>}
 */
export async function sendMail(message) {
  const config = readConfig()
  const payload = {
    from: config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html ?? undefined,
    date: new Date().toISOString(),
  }

  if (config.transport === 'smtp') {
    const transport = await getSmtpTransport()
    const info = await transport.sendMail(payload)
    return { delivered: true, transport: 'smtp', id: info.messageId }
  }

  if (config.transport === 'file') {
    mkdirSync(config.outboxDir, { recursive: true })
    const fileName = `${Date.now()}-${randomBytes(4).toString('hex')}.json`
    const filePath = path.join(config.outboxDir, fileName)
    appendFileSync(filePath, JSON.stringify(payload, null, 2))
    return { delivered: true, transport: 'file', path: filePath }
  }

  // Transporte por defecto: consola.
  console.log(`\n[MAIL:console] -> ${payload.to}\n  Asunto: ${payload.subject}\n  ${payload.text.replace(/\n/g, '\n  ')}\n`)
  return { delivered: true, transport: 'console' }
}

/**
 * @param {{ email: string, displayName?: string }} user
 * @param {string} code
 */
export async function sendVerificationEmail(user, code) {
  const name = (user.displayName || '').trim() || 'ciudadano'
  const subject = 'Tu codigo de verificacion de VensuR'
  const text = [
    `Hola ${name},`,
    '',
    `Tu codigo de verificacion es: ${code}`,
    '',
    'Ingresalo en la app para activar tu cuenta. El codigo caduca en unos minutos.',
    'Si no creaste esta cuenta, ignora este mensaje.',
    '',
    'VensuR',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 12px">Verifica tu correo</h2>
      <p style="margin:0 0 16px">Hola ${escapeHtml(name)}, tu codigo de verificacion es:</p>
      <p style="font-size:30px;letter-spacing:6px;font-weight:700;margin:0 0 16px">${escapeHtml(code)}</p>
      <p style="margin:0 0 8px;color:#555">Ingresalo en la app para activar tu cuenta. Caduca en unos minutos.</p>
      <p style="margin:0;color:#999;font-size:13px">Si no creaste esta cuenta, ignora este mensaje.</p>
    </div>
  `.trim()

  return sendMail({ to: user.email, subject, text, html })
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

// Utilidades puras (sin acceso a base de datos ni estado de la app).
// Extraidas de server/index.js para aligerar el archivo principal.

// --- Fechas ---

export function nowIso() {
  return new Date().toISOString()
}

export function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

export function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function buildRecentDayKeys(daysCount = 7) {
  const total = Math.max(1, Math.min(31, Math.trunc(daysCount)))
  const out = []

  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000)
    out.push(date.toISOString().slice(0, 10))
  }

  return out
}

export function isExpired(isoDate) {
  const timestamp = Date.parse(isoDate)
  if (!Number.isFinite(timestamp)) return true
  return timestamp <= Date.now()
}

export function parseIsoTimestamp(value) {
  const parsed = Date.parse(typeof value === 'string' ? value : '')
  return Number.isFinite(parsed) ? parsed : 0
}

// --- Primitivos ---

export function toNumeric(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function safeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function toBooleanFlag(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'si' || normalized === 'yes'
  }

  return false
}

export function clampNumberInRange(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function clampChance(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(1, parsed))
}

export function clampBurst(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(8, parsed))
}

// --- Normalizacion de texto ---

export function toSlugToken(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function buildStoryTitleFromCaption(value) {
  const text = safeString(value)
  if (!text) return 'Historia ciudadana'
  return text.slice(0, 80)
}

export function normalizeVerificationCode(value) {
  return safeString(value).replace(/\D/g, '').slice(0, 6)
}

export function normalizeEmail(value) {
  return safeString(value).toLowerCase()
}

export function normalizeUsername(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

export function normalizePhone(value) {
  return safeString(value)
    .replace(/[^0-9+()\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 28)
}

export function normalizeProfileVisibility(value) {
  const normalized = safeString(value).toLowerCase()
  return normalized === 'public' ? 'public' : 'private'
}

export function normalizeSearchQuery(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

export function escapeSqlLikePattern(value) {
  return safeString(value).replace(/[\\%_]/g, (symbol) => `\\${symbol}`)
}

export function normalizeHexColor(value) {
  const text = safeString(value)
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text) ? text : '#ffffff'
}

export function normalizeMode(mode) {
  const key = safeString(mode).toLowerCase()
  if (key === 'low' || key === 'high' || key === 'normal') return key
  return 'normal'
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

// --- Validacion / saneo ---

export function cleanDisplayName(value) {
  const trimmed = safeString(value)
  if (!trimmed) return ''
  return trimmed.slice(0, 80)
}

export function cleanBio(value) {
  const trimmed = safeString(value)
  return trimmed.slice(0, 280)
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function isValidUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(username)
}

export function isValidPhone(phone) {
  if (!phone) return true
  return /^[0-9+()\-\s]{6,28}$/.test(phone)
}

export function isBcryptHash(value) {
  return typeof value === 'string' && value.startsWith('$2')
}

// --- HTTP ---

export function sendError(res, statusCode, message, details = {}) {
  res.status(statusCode).json({ error: message, ...details })
}

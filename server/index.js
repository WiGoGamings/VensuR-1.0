import 'dotenv/config'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import Database from 'better-sqlite3'
import express from 'express'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { OAuth2Client } from 'google-auth-library'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { nanoid } from 'nanoid'
import { Buffer } from 'node:buffer'
import { createHash, randomInt } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { sendVerificationEmail } from './lib/mailer.js'
import {
  addDaysIso,
  addMinutesIso,
  buildRecentDayKeys,
  buildStoryTitleFromCaption,
  clampBurst,
  clampChance,
  clampNumberInRange,
  cleanBio,
  cleanDisplayName,
  escapeSqlLikePattern,
  escapeXml,
  isBcryptHash,
  isExpired,
  isValidEmail,
  isValidPhone,
  isValidUsername,
  normalizeEmail,
  normalizeHexColor,
  normalizeMode,
  normalizePhone,
  normalizeProfileVisibility,
  normalizeSearchQuery,
  normalizeUsername,
  normalizeVerificationCode,
  nowIso,
  parseIsoTimestamp,
  safeString,
  sendError,
  toBooleanFlag,
  toNumeric,
  toSlugToken,
} from './lib/helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.join(__dirname, 'data')
const UPLOADS_DIR = safeString(process.env.UPLOADS_DIR) || path.join(__dirname, 'uploads')
const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const DB_PATH = safeString(process.env.DB_PATH) || path.join(DATA_DIR, 'vensur.db')
const PUBLIC_MEDIA_FILE_PREFIX = 'public-seed-'

const IS_PRODUCTION = process.env.NODE_ENV === 'production'
const AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET ?? 'vensur-dev-secret-change-me'

if (IS_PRODUCTION && (!process.env.AUTH_JWT_SECRET || AUTH_JWT_SECRET.length < 24)) {
  throw new Error('AUTH_JWT_SECRET debe definirse con un valor fuerte (>=24 caracteres) en produccion.')
}

const AUTH_JWT_EXPIRES_IN = process.env.AUTH_JWT_EXPIRES_IN ?? '7d'
const API_PORT = Number.parseInt(process.env.API_PORT ?? '8787', 10) || 8787
const TRUST_PROXY = safeString(process.env.TRUST_PROXY)
const ALLOWED_ORIGINS = safeString(process.env.ALLOWED_ORIGINS)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const BOT_USER_COUNT_MAX = 500
const BOT_USER_COUNT_DEFAULT = 200
const BOTS_ENABLED = String(process.env.BOTS_ENABLED ?? process.env.NODE_ENV !== 'production')
  .trim()
  .toLowerCase() === 'true'
const BOTS_TICK_INTERVAL_MS = Number.parseInt(process.env.BOTS_TICK_INTERVAL_MS ?? '60000', 10) || 60000
const BOTS_BOOTSTRAP_CONTENT = String(process.env.BOTS_BOOTSTRAP_CONTENT ?? 'true')
  .trim()
  .toLowerCase() === 'true'
const BOT_CONTROL_TOKEN = (process.env.BOT_CONTROL_TOKEN ?? '').trim()
const BOT_MEDIA_POOL_LIMIT = Number.parseInt(process.env.BOT_MEDIA_POOL_LIMIT ?? '360', 10) || 360
const BOT_ACTIVITY_MODE = String(process.env.BOT_ACTIVITY_MODE ?? 'normal').trim().toLowerCase()
const EMAIL_VERIFICATION_CODE_TTL_MINUTES = Number.parseInt(
  process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES ?? '15',
  10,
) || 15
const EXPOSE_DEV_VERIFICATION_CODE = process.env.NODE_ENV !== 'production'

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID ?? '').trim()
const APPLE_CLIENT_ID = (process.env.APPLE_CLIENT_ID ?? '').trim()
const RSS_PROXY_TIMEOUT_MS = Number.parseInt(process.env.RSS_PROXY_TIMEOUT_MS ?? '8500', 10) || 8500
const ALLOWED_RSS_HOSTS = [
  'elnacional.com',
  'efectococuyo.com',
  'talcualdigital.com',
  'runrun.es',
  'armando.info',
  'transparencia.org.ve',
  'provea.org',
  'foropenal.com',
]

const BOT_RSS_MEDIA_FEEDS = [
  'https://www.elnacional.com/feed/',
  'https://efectococuyo.com/feed/',
  'https://talcualdigital.com/feed/',
  'https://runrun.es/feed/',
  'https://armando.info/feed/',
  'https://transparencia.org.ve/feed/',
  'https://provea.org/feed/',
  'https://foropenal.com/feed/',
]

const SOCIAL_PASSWORD_SENTINEL = '__oauth_only__'
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null

const BOT_BASE_PROFILES = [
  {
    email: 'bot.reportera@vensur.local',
    username: 'bot_reportera',
    displayName: 'Bot Reportera',
    defaultLocation: 'Caracas',
    mediaKey: 'reportera',
  },
  {
    email: 'bot.alertas@vensur.local',
    username: 'bot_alertas',
    displayName: 'Bot Alertas',
    defaultLocation: 'Maracaibo',
    mediaKey: 'alertas',
  },
  {
    email: 'bot.vecinal@vensur.local',
    username: 'bot_vecinal',
    displayName: 'Bot Vecinal',
    defaultLocation: 'Valencia',
    mediaKey: 'vecinal',
  },
  {
    email: 'bot.radar@vensur.local',
    username: 'bot_radar',
    displayName: 'Bot Radar',
    defaultLocation: 'Barquisimeto',
    mediaKey: 'radar',
  },
]

const BOT_FIRST_NAMES = [
  'Adriana',
  'Luis',
  'Daniela',
  'Miguel',
  'Camila',
  'Jose',
  'Gabriela',
  'Ricardo',
  'Valentina',
  'Carlos',
  'Andrea',
  'Rafael',
  'Paola',
  'Diego',
  'Isabel',
  'Alejandro',
  'Mariana',
  'Antonio',
  'Lucia',
  'Fernando',
  'Sofia',
  'Javier',
  'Elena',
  'Manuel',
  'Natalia',
]

const BOT_LAST_NAMES = [
  'Rojas',
  'Mendoza',
  'Castillo',
  'Perez',
  'Suarez',
  'Ferrer',
  'Marquez',
  'Ramirez',
  'Salazar',
  'Gonzalez',
  'Contreras',
  'Vasquez',
  'Aponte',
  'Urbina',
  'Cedeno',
  'Pineda',
  'Bracho',
  'Arias',
  'Montilla',
  'Caraballo',
  'Quintero',
  'Rangel',
  'Ortega',
  'Veliz',
  'Coronel',
]

function toSafeBotCount(rawValue) {
  const parsed = Number.parseInt(rawValue ?? '', 10)
  if (!Number.isFinite(parsed)) return BOT_USER_COUNT_DEFAULT

  return Math.max(1, Math.min(BOT_USER_COUNT_MAX, parsed))
}

function appendBotSuffixToEmail(email, suffix) {
  const atIndex = email.indexOf('@')
  if (atIndex < 0) return `${email}.${suffix}`

  return `${email.slice(0, atIndex)}.${suffix}${email.slice(atIndex)}`
}

function buildBotDisplayName(index) {
  const first = BOT_FIRST_NAMES[index % BOT_FIRST_NAMES.length]
  const last = BOT_LAST_NAMES[Math.floor(index / BOT_FIRST_NAMES.length) % BOT_LAST_NAMES.length]
  const baseName = `${first} ${last}`
  const maxSimple = BOT_FIRST_NAMES.length * BOT_LAST_NAMES.length

  if (index < maxSimple) return baseName
  return `${baseName} ${String(index + 1).padStart(3, '0')}`
}

function buildBotProfiles(totalBots) {
  const count = toSafeBotCount(totalBots)

  return Array.from({ length: count }, (_, index) => {
    const base = BOT_BASE_PROFILES[index % BOT_BASE_PROFILES.length]
    const displayName = buildBotDisplayName(index)

    if (index < BOT_BASE_PROFILES.length) {
      return {
        ...base,
        displayName,
      }
    }

    const suffix = String(index + 1).padStart(3, '0')
    const firstToken = toSlugToken(displayName.split(' ')[0]).slice(0, 7)
    const lastToken = toSlugToken(displayName.split(' ').slice(1).join(' ')).slice(0, 7)
    const uniqueToken = `${firstToken}${lastToken}`.slice(0, 10)

    return {
      ...base,
      email: appendBotSuffixToEmail(base.email, suffix),
      username: `bot_${uniqueToken}_${suffix}`.slice(0, 24),
      displayName,
    }
  })
}

const BOT_USER_COUNT = toSafeBotCount(process.env.BOT_USER_COUNT)
const BOT_PROFILES = buildBotProfiles(BOT_USER_COUNT)

const BOT_MEDIA_LIBRARY = [
  {
    key: 'reportera',
    filename: 'bot-reportera.svg',
    title: 'Reporte ciudadano',
    subtitle: 'Cobertura local en tiempo real',
    colorA: '#f59e0b',
    colorB: '#ef4444',
  },
  {
    key: 'alertas',
    filename: 'bot-alertas.svg',
    title: 'Alerta comunitaria',
    subtitle: 'Actualizacion de seguridad vecinal',
    colorA: '#22c55e',
    colorB: '#0ea5e9',
  },
  {
    key: 'vecinal',
    filename: 'bot-vecinal.svg',
    title: 'Observatorio vecinal',
    subtitle: 'Incidencias y movilidad urbana',
    colorA: '#14b8a6',
    colorB: '#3b82f6',
  },
  {
    key: 'radar',
    filename: 'bot-radar.svg',
    title: 'Radar ciudadano',
    subtitle: 'Verificacion colaborativa',
    colorA: '#a855f7',
    colorB: '#6366f1',
  },
]

const BOT_LOCATIONS = [
  'Caracas',
  'Maracaibo',
  'Valencia',
  'Barquisimeto',
  'Puerto La Cruz',
  'Merida',
  'San Cristobal',
]

const BOT_POST_CAPTIONS = [
  'Actualizacion ciudadana: vecinos denuncian operativo con presencia armada en la zona.',
  'Reporte local: cortes electricos prolongados y fallas de agua afectan al sector hoy.',
  'Seguimiento comunitario: se registran detenciones y tension en puntos de concentracion.',
  'Monitoreo de DDHH: familias reportan hostigamiento y control irregular en la via principal.',
  'Alerta vecinal: denuncian presion sobre comerciantes y cierres forzados en el area.',
  'Cobertura colaborativa: se investigan irregularidades y posible red de corrupcion local.',
]

const BOT_STORY_CAPTIONS = [
  'Historia automatica sobre denuncia ciudadana en curso.',
  'Registro breve de situacion critica reportada por vecinos.',
  'Actualizacion visual de seguimiento a vulneraciones y riesgos.',
  'Reporte rapido desde observatorio comunitario independiente.',
]

const BOT_DARK_TOPIC_KEYWORDS = [
  'venezuela',
  'caracas',
  'protest',
  'repres',
  'colectiv',
  'ddhh',
  'corrup',
  'deten',
  'preso',
  'violenc',
  'apag',
  'crisis',
  'foro penal',
  'provea',
  'armando',
  'transparencia',
  'fiscal',
  'homicid',
  'desapar',
  'derechos humanos',
]

const BOT_COMMENT_TOPIC_RULES = [
  {
    key: 'energia',
    pattern: /(apag|electric|luz|energia|servicio)/i,
  },
  {
    key: 'represion',
    pattern: /(deten|operativo|hostig|repres|protest|control)/i,
  },
  {
    key: 'corrupcion',
    pattern: /(corrup|irregular|soborno|desvio|contrato|fiscal)/i,
  },
  {
    key: 'violencia',
    pattern: /(armad|violenc|amenaza|riesgo|ataque)/i,
  },
]

const BOT_COMMENT_TEMPLATES = {
  energia: [
    'En {location} seguimos con reportes de cortes. Este aviso coincide con lo que venimos documentando.',
    'Vecinos del sector tambien reportan fallas de luz y agua en la misma franja horaria.',
    'Confirmado por la red comunitaria: la afectacion del servicio sigue activa en {location}.',
  ],
  represion: [
    'Gracias por el reporte. Ya hay otros avisos de tension y control en puntos cercanos.',
    'Este caso coincide con alertas recientes de detenciones y presion en la zona.',
    'Se suma al monitoreo de derechos ciudadanos que estamos consolidando desde {location}.',
  ],
  corrupcion: [
    'El dato es clave. Lo cruzaremos con denuncias previas de irregularidades en el area.',
    'Hay antecedentes similares; este aporte ayuda a conectar mejor el patron de corrupcion local.',
    'Gracias por compartirlo, esta evidencia encaja con otros reportes de gestion opaca.',
  ],
  violencia: [
    'Recibido. En {location} tambien se reporta aumento de riesgo y presencia armada.',
    'Este testimonio coincide con alertas de seguridad de otras comunidades cercanas.',
    'Queda registrado para seguimiento preventivo y verificacion colectiva en tiempo real.',
  ],
  general: [
    'Aporte validado por la red. Seguimos contrastando informacion en {location}.',
    'Gracias por publicar. Este registro ayuda a mantener el mapa ciudadano actualizado.',
    'Seguimos el hilo de esta publicacion con reportes de campo y contraste comunitario.',
  ],
}

const BOT_ZONE_RULES = [
  {
    key: 'capital',
    pattern: /(caracas|miranda|la guaira)/i,
    sentence: 'En la region capital seguimos monitoreo coordinado entre comunidades y rutas de apoyo.',
  },
  {
    key: 'zulia',
    pattern: /(maracaibo|zulia)/i,
    sentence: 'En Zulia se repiten alertas de servicios y tension local, por eso mantenemos contraste conjunto.',
  },
  {
    key: 'andes',
    pattern: /(merida|san cristobal|tachira)/i,
    sentence: 'Desde los Andes hay seguimiento vecinal continuo para validar incidencias y cambios en terreno.',
  },
  {
    key: 'centroccidente',
    pattern: /(valencia|barquisimeto|carabobo|lara)/i,
    sentence: 'En la zona centro-occidente este tipo de reporte se cruza con observacion comunitaria activa.',
  },
  {
    key: 'oriente',
    pattern: /(puerto la cruz|anzoategui|oriente)/i,
    sentence: 'En Oriente mantenemos cadena de verificacion local para conectar este caso con otros avisos.',
  },
]

const BOT_COMMENT_MEMORY_SIZE = 28
const BOT_COMMENT_RECENT_BLOCK = 8

const BOT_ACTIVITY_PRESETS = {
  low: {
    createPostChance: 0.44,
    createStoryChance: 0.28,
    preferVideoPostChance: 0.24,
    preferVideoStoryChance: 0.18,
    collaborativePairChance: 0.3,
    commentBurstMin: 1,
    commentBurstMax: 2,
    postReactionBurstMin: 1,
    postReactionBurstMax: 1,
    storyReactionBurstMin: 1,
    storyReactionBurstMax: 1,
  },
  normal: {
    createPostChance: 0.78,
    createStoryChance: 0.56,
    preferVideoPostChance: 0.42,
    preferVideoStoryChance: 0.35,
    collaborativePairChance: 0.55,
    commentBurstMin: 1,
    commentBurstMax: 2,
    postReactionBurstMin: 1,
    postReactionBurstMax: 1,
    storyReactionBurstMin: 1,
    storyReactionBurstMax: 1,
  },
  high: {
    createPostChance: 0.92,
    createStoryChance: 0.74,
    preferVideoPostChance: 0.5,
    preferVideoStoryChance: 0.44,
    collaborativePairChance: 0.82,
    commentBurstMin: 2,
    commentBurstMax: 4,
    postReactionBurstMin: 1,
    postReactionBurstMax: 2,
    storyReactionBurstMin: 1,
    storyReactionBurstMax: 2,
  },
}

const LIVE_STREAM_MAX_DURATION_MS = 4 * 60 * 60 * 1000
const LIVE_STREAM_PENDING_OFFER_TTL_MS = 90_000
const LIVE_STREAM_IDLE_VIEWER_TTL_MS = 12 * 60 * 1000
const LIVE_RECORDING_TTL_HOURS = Number.parseInt(process.env.LIVE_RECORDING_TTL_HOURS ?? '72', 10) || 72
const LIVE_RECORDING_MAX_BYTES = Number.parseInt(process.env.LIVE_RECORDING_MAX_BYTES ?? '', 10) || 180 * 1024 * 1024
const LIVE_RECORDING_CLEANUP_INTERVAL_MS = 60 * 60 * 1000
const STORY_FILTER_NAMES = new Set([
  // Legado
  'none', 'warm', 'cold', 'mono', 'dramatic',
  // Presets tipo Instagram (usados por el editor visual de historias en video)
  'normal', 'clarendon', 'gingham', 'moon', 'lark', 'reyes', 'juno',
  'slumber', 'crema', 'ludwig', 'aden', 'perpetua',
])

const MUSIC_LIBRARY_SEED = [
  { id: 'track-amanecer-andino', title: 'Amanecer Andino', artist: 'Archivo VensuR', genre: 'Ambient', mood: 'Merida', durationSec: 34, toneHz: 174 },
  { id: 'track-catia-ritmo-urbano', title: 'Catia Ritmo Urbano', artist: 'Archivo VensuR', genre: 'Urbano', mood: 'Caracas', durationSec: 28, toneHz: 196 },
  { id: 'track-maracaibo-luz', title: 'Maracaibo Luz', artist: 'Archivo VensuR', genre: 'Electronico', mood: 'Zulia', durationSec: 31, toneHz: 208 },
  { id: 'track-lluvia-lanera', title: 'Lluvia Llanera', artist: 'Archivo VensuR', genre: 'Folklore', mood: 'Apure', durationSec: 36, toneHz: 220 },
  { id: 'track-valencia-ruta', title: 'Valencia Ruta', artist: 'Archivo VensuR', genre: 'Synthwave', mood: 'Carabobo', durationSec: 30, toneHz: 233 },
  { id: 'track-caribe-alerta', title: 'Caribe Alerta', artist: 'Archivo VensuR', genre: 'Percusion', mood: 'Anzoategui', durationSec: 26, toneHz: 247 },
  { id: 'track-barquisimeto-voces', title: 'Barquisimeto Voces', artist: 'Archivo VensuR', genre: 'Indie', mood: 'Lara', durationSec: 29, toneHz: 262 },
  { id: 'track-oriente-monitor', title: 'Oriente Monitor', artist: 'Archivo VensuR', genre: 'Downtempo', mood: 'Sucre', durationSec: 35, toneHz: 277 },
  { id: 'track-guaicaipuro-firme', title: 'Guaicaipuro Firme', artist: 'Archivo VensuR', genre: 'Drum', mood: 'Miranda', durationSec: 27, toneHz: 294 },
  { id: 'track-rio-quieto', title: 'Rio Quieto', artist: 'Archivo VensuR', genre: 'Acustico', mood: 'Bolivar', durationSec: 33, toneHz: 311 },
  { id: 'track-radar-popular', title: 'Radar Popular', artist: 'Archivo VensuR', genre: 'Hybrid', mood: 'Distrito Capital', durationSec: 32, toneHz: 330 },
  { id: 'track-mapa-colectivo', title: 'Mapa Colectivo', artist: 'Archivo VensuR', genre: 'Minimal', mood: 'Aragua', durationSec: 30, toneHz: 349 },
  { id: 'track-alerta-frontera', title: 'Alerta Frontera', artist: 'Archivo VensuR', genre: 'Pulse', mood: 'Tachira', durationSec: 29, toneHz: 370 },
  { id: 'track-luz-barrial', title: 'Luz Barrial', artist: 'Archivo VensuR', genre: 'Lo-Fi', mood: 'Portuguesa', durationSec: 38, toneHz: 392 },
  { id: 'track-eco-comunidad', title: 'Eco Comunidad', artist: 'Archivo VensuR', genre: 'Atmosfera', mood: 'Monagas', durationSec: 34, toneHz: 415 },
  { id: 'track-guardia-ciudadana', title: 'Guardia Ciudadana', artist: 'Archivo VensuR', genre: 'Cinematic', mood: 'Yaracuy', durationSec: 37, toneHz: 440 },
  { id: 'track-puerto-voz', title: 'Puerto Voz', artist: 'Archivo VensuR', genre: 'House', mood: 'La Guaira', durationSec: 28, toneHz: 466 },
  { id: 'track-delta-ruta', title: 'Delta Ruta', artist: 'Archivo VensuR', genre: 'Electro Folk', mood: 'Delta Amacuro', durationSec: 32, toneHz: 494 },
]

const botRuntime = {
  timerId: null,
  ticks: 0,
  lastTickAt: '',
  users: [],
  behavior: buildInitialBotBehavior(),
  commentTemplateMemoryByUser: new Map(),
  mediaPool: {
    images: [],
    videos: [],
    total: 0,
    refreshedAt: '',
  },
}

const liveRuntime = {
  sessions: new Map(),
}

mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(UPLOADS_DIR, { recursive: true })
mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  const hasColumn = columns.some((column) => column.name === columnName)
  if (hasColumn) return

  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run()
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      profile_visibility TEXT NOT NULL DEFAULT 'private',
      email_verified INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      friend_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      pair_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS follows (
      id TEXT PRIMARY KEY,
      follower_user_id TEXT NOT NULL,
      followed_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(follower_user_id, followed_user_id),
      FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS social_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_sub TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, provider_sub),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      caption TEXT NOT NULL,
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT 'Venezuela',
      reactions INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '',
      reactions INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS live_streams (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS live_recordings (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'video/webm',
      duration_sec INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS music_library (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT '',
      duration_sec INTEGER NOT NULL DEFAULT 0,
      preview_url TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_reactions (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS story_reactions (
      story_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (story_id, user_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_posts_user_created_at ON posts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_post_comments_post_created_at ON post_comments(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_post_comments_user_created_at ON post_comments(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_post_reactions_user ON post_reactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_story_reactions_user ON story_reactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_stories_user_created_at ON stories(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_live_streams_owner_status ON live_streams(owner_user_id, status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_live_streams_status_started ON live_streams(status, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_live_recordings_owner_created ON live_recordings(owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_live_recordings_expires ON live_recordings(expires_at);
    CREATE INDEX IF NOT EXISTS idx_music_library_active_updated ON music_library(is_active, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_music_library_title ON music_library(title);
    CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON friendships(user_id);
    CREATE INDEX IF NOT EXISTS idx_friendships_friend_id ON friendships(friend_id);
    CREATE INDEX IF NOT EXISTS idx_friendships_pair_key ON friendships(pair_key);
    CREATE INDEX IF NOT EXISTS idx_follows_follower_user_id ON follows(follower_user_id);
    CREATE INDEX IF NOT EXISTS idx_follows_followed_user_id ON follows(followed_user_id);
    CREATE INDEX IF NOT EXISTS idx_follows_pair ON follows(follower_user_id, followed_user_id);
    CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id ON social_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user_created ON email_verification_codes(user_id, created_at DESC);
  `)

  ensureColumn('users', 'bio', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('users', 'phone', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('users', 'profile_visibility', "TEXT NOT NULL DEFAULT 'private'")
  ensureColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('users', 'avatar_url', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('users', 'cover_url', "TEXT NOT NULL DEFAULT ''")

  ensureColumn('posts', 'media_url', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('posts', 'media_type', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('posts', 'location', "TEXT NOT NULL DEFAULT 'Venezuela'")
  ensureColumn('posts', 'comments', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('posts', 'views', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('posts', 'updated_at', "TEXT NOT NULL DEFAULT ''")

  ensureColumn('stories', 'description', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('stories', 'media_url', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('stories', 'media_type', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('stories', 'metadata_json', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('stories', 'reactions', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('stories', 'views', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('stories', 'comments', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('stories', 'expires_at', "TEXT NOT NULL DEFAULT ''")

  ensureColumn('live_recordings', 'views', 'INTEGER NOT NULL DEFAULT 0')

  ensureColumn('music_library', 'artist', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('music_library', 'genre', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('music_library', 'mood', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('music_library', 'duration_sec', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn('music_library', 'preview_url', "TEXT NOT NULL DEFAULT ''")
  ensureColumn('music_library', 'is_active', 'INTEGER NOT NULL DEFAULT 1')
}

runMigrations()

const selectUserByIdStmt = db.prepare(`
  SELECT id, email, username, display_name, password_hash, bio, phone, profile_visibility, email_verified, avatar_url, cover_url, created_at, updated_at
  FROM users
  WHERE id = ?
  LIMIT 1
`)

const selectUserByEmailStmt = db.prepare(`
  SELECT id, email, username, display_name, password_hash, bio, phone, profile_visibility, email_verified, avatar_url, cover_url, created_at, updated_at
  FROM users
  WHERE email = ?
  LIMIT 1
`)

const selectUserByUsernameStmt = db.prepare(`
  SELECT id
  FROM users
  WHERE username = ?
  LIMIT 1
`)

const selectUserForLoginStmt = db.prepare(`
  SELECT id, email, username, display_name, password_hash, bio, phone, profile_visibility, email_verified, avatar_url, cover_url, created_at, updated_at
  FROM users
  WHERE email = ? OR username = ?
  LIMIT 1
`)

const insertUserStmt = db.prepare(`
  INSERT INTO users (
    id, email, username, display_name, password_hash, bio, phone, email_verified, avatar_url, cover_url, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const updateUserProfileStmt = db.prepare(`
  UPDATE users
  SET display_name = ?, username = ?, bio = ?, email = ?, phone = ?, updated_at = ?
  WHERE id = ?
`)

const updateUserVisibilityStmt = db.prepare(`
  UPDATE users
  SET profile_visibility = ?, updated_at = ?
  WHERE id = ?
`)

const updateUserAvatarStmt = db.prepare(`
  UPDATE users
  SET avatar_url = ?, updated_at = ?
  WHERE id = ?
`)

const updateUserCoverStmt = db.prepare(`
  UPDATE users
  SET cover_url = ?, updated_at = ?
  WHERE id = ?
`)

const updateUserSocialDetailsStmt = db.prepare(`
  UPDATE users
  SET display_name = ?, email_verified = ?, avatar_url = ?, updated_at = ?
  WHERE id = ?
`)

const markUserEmailVerifiedStmt = db.prepare(`
  UPDATE users
  SET email_verified = 1, updated_at = ?
  WHERE id = ?
`)

const selectUserBySocialSubStmt = db.prepare(`
  SELECT u.id, u.email, u.username, u.display_name, u.password_hash, u.bio, u.phone, u.profile_visibility, u.email_verified, u.avatar_url, u.cover_url, u.created_at, u.updated_at
  FROM social_accounts s
  JOIN users u ON u.id = s.user_id
  WHERE s.provider = ? AND s.provider_sub = ?
  LIMIT 1
`)

const selectUserSummaryByUsernameStmt = db.prepare(`
  SELECT id, username, display_name, avatar_url
  FROM users
  WHERE username = ?
  LIMIT 1
`)

const searchUsersDirectoryStmt = db.prepare(`
  SELECT id, username, display_name, avatar_url, cover_url, bio, profile_visibility, created_at, updated_at
  FROM users
  WHERE (
    lower(username) LIKE ? ESCAPE '\\'
    OR lower(display_name) LIKE ? ESCAPE '\\'
    OR lower(email) LIKE ? ESCAPE '\\'
  )
  ORDER BY
    CASE
      WHEN lower(username) = ? THEN 0
      WHEN lower(display_name) = ? THEN 1
      WHEN lower(username) LIKE ? ESCAPE '\\' THEN 2
      ELSE 3
    END,
    updated_at DESC
  LIMIT ?
`)

const listUsersDirectoryStmt = db.prepare(`
  SELECT id, username, display_name, avatar_url, cover_url, bio, profile_visibility, created_at, updated_at
  FROM users
  ORDER BY updated_at DESC
  LIMIT ?
`)

const selectUserDirectoryProfileByUsernameStmt = db.prepare(`
  SELECT id, username, display_name, avatar_url, cover_url, bio, profile_visibility, created_at, updated_at
  FROM users
  WHERE username = ?
  LIMIT 1
`)

const selectFollowRelationStmt = db.prepare(`
  SELECT id
  FROM follows
  WHERE follower_user_id = ? AND followed_user_id = ?
  LIMIT 1
`)

const insertFollowRelationStmt = db.prepare(`
  INSERT OR IGNORE INTO follows (id, follower_user_id, followed_user_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`)

const deleteFollowRelationStmt = db.prepare(`
  DELETE FROM follows
  WHERE follower_user_id = ? AND followed_user_id = ?
`)

const countFollowersByUserStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM follows
  WHERE followed_user_id = ?
`)

const countFollowingByUserStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM follows
  WHERE follower_user_id = ?
`)

const selectAcceptedFriendshipByPairStmt = db.prepare(`
  SELECT id
  FROM friendships
  WHERE pair_key = ? AND status = 'accepted'
  LIMIT 1
`)

const insertAcceptedFriendshipStmt = db.prepare(`
  INSERT INTO friendships (id, user_id, friend_id, status, pair_key, created_at, updated_at)
  VALUES (?, ?, ?, 'accepted', ?, ?, ?)
`)

const deleteFriendshipByPairStmt = db.prepare(`
  DELETE FROM friendships
  WHERE pair_key = ?
`)

const listAcceptedFriendsByUserStmt = db.prepare(`
  SELECT
    u.id,
    u.username,
    u.display_name,
    u.avatar_url
  FROM friendships f
  JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
  WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
  ORDER BY u.display_name COLLATE NOCASE ASC
  LIMIT 500
`)

const selectSocialAccountStmt = db.prepare(`
  SELECT id, user_id, provider, provider_sub, email, created_at, updated_at
  FROM social_accounts
  WHERE provider = ? AND provider_sub = ?
  LIMIT 1
`)

const insertSocialAccountStmt = db.prepare(`
  INSERT INTO social_accounts (id, user_id, provider, provider_sub, email, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`)

const updateSocialAccountStmt = db.prepare(`
  UPDATE social_accounts
  SET email = ?, updated_at = ?
  WHERE provider = ? AND provider_sub = ?
`)

const listSocialProvidersByUserStmt = db.prepare(`
  SELECT provider
  FROM social_accounts
  WHERE user_id = ?
  ORDER BY provider ASC
`)

const insertPostStmt = db.prepare(`
  INSERT INTO posts (
    id, user_id, caption, media_url, media_type, location, reactions, comments, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const selectPostsStmt = db.prepare(`
  SELECT
    p.id,
    p.user_id,
    p.caption,
    p.media_url,
    p.media_type,
    p.location,
    p.reactions,
    p.comments,
    p.views,
    p.created_at,
    p.updated_at,
    u.display_name,
    u.username,
    u.profile_visibility
  FROM posts p
  JOIN users u ON u.id = p.user_id
  ORDER BY p.created_at DESC
  LIMIT 300
`)

const selectPostsByOwnerStmt = db.prepare(`
  SELECT
    p.id,
    p.user_id,
    p.caption,
    p.media_url,
    p.media_type,
    p.location,
    p.reactions,
    p.comments,
    p.views,
    p.created_at,
    p.updated_at,
    u.display_name,
    u.username,
    u.profile_visibility
  FROM posts p
  JOIN users u ON u.id = p.user_id
  WHERE p.user_id = ?
  ORDER BY p.created_at DESC
  LIMIT 500
`)

const selectPostByIdStmt = db.prepare(`
  SELECT
    p.id,
    p.user_id,
    p.caption,
    p.media_url,
    p.media_type,
    p.location,
    p.reactions,
    p.comments,
    p.views,
    p.created_at,
    p.updated_at,
    u.display_name,
    u.username,
    u.profile_visibility
  FROM posts p
  JOIN users u ON u.id = p.user_id
  WHERE p.id = ?
  LIMIT 1
`)

const updatePostReactionsStmt = db.prepare(`
  UPDATE posts
  SET reactions = CASE
    WHEN reactions + ? < 0 THEN 0
    ELSE reactions + ?
  END,
  updated_at = ?
  WHERE id = ?
`)

const selectPostReactionStmt = db.prepare(`
  SELECT 1 FROM post_reactions WHERE post_id = ? AND user_id = ? LIMIT 1
`)

const insertPostReactionStmt = db.prepare(`
  INSERT OR IGNORE INTO post_reactions (post_id, user_id, created_at) VALUES (?, ?, ?)
`)

const deletePostReactionStmt = db.prepare(`
  DELETE FROM post_reactions WHERE post_id = ? AND user_id = ?
`)

const selectLikedPostIdsByUserStmt = db.prepare(`
  SELECT post_id FROM post_reactions WHERE user_id = ?
`)

const selectStoryReactionStmt = db.prepare(`
  SELECT 1 FROM story_reactions WHERE story_id = ? AND user_id = ? LIMIT 1
`)

const insertStoryReactionStmt = db.prepare(`
  INSERT OR IGNORE INTO story_reactions (story_id, user_id, created_at) VALUES (?, ?, ?)
`)

const deleteStoryReactionStmt = db.prepare(`
  DELETE FROM story_reactions WHERE story_id = ? AND user_id = ?
`)

const selectLikedStoryIdsByUserStmt = db.prepare(`
  SELECT story_id FROM story_reactions WHERE user_id = ?
`)

const incrementPostCommentsStmt = db.prepare(`
  UPDATE posts
  SET comments = comments + 1,
  updated_at = ?
  WHERE id = ?
`)

const incrementPostViewsStmt = db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?')
const incrementStoryViewsStmt = db.prepare('UPDATE stories SET views = views + 1 WHERE id = ?')
const incrementLiveRecordingViewsStmt = db.prepare(
  'UPDATE live_recordings SET views = views + 1 WHERE id = ?',
)

const insertPostCommentStmt = db.prepare(`
  INSERT INTO post_comments (
    id, post_id, user_id, text, created_at
  ) VALUES (?, ?, ?, ?, ?)
`)

const selectPostCommentsStmt = db.prepare(`
  SELECT
    c.id,
    c.post_id,
    c.user_id,
    c.text,
    c.created_at,
    u.display_name,
    u.username
  FROM post_comments c
  JOIN users u ON u.id = c.user_id
  WHERE c.post_id = ?
  ORDER BY c.created_at DESC
  LIMIT 120
`)

const insertStoryStmt = db.prepare(`
  INSERT INTO stories (
    id, user_id, title, description, media_url, media_type, metadata_json, reactions, expires_at, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const selectStoriesByOwnerStmt = db.prepare(`
  SELECT
    id,
    user_id,
    title,
    description,
    media_url,
    media_type,
    metadata_json,
    reactions,
    views,
    comments,
    expires_at,
    created_at
  FROM stories
  WHERE user_id = ?
  ORDER BY created_at DESC
  LIMIT 200
`)

const selectActiveStoriesStmt = db.prepare(`
  SELECT
    s.id,
    s.user_id,
    s.title,
    s.description,
    s.media_url,
    s.media_type,
    s.metadata_json,
    s.reactions,
    s.views,
    s.comments,
    s.expires_at,
    s.created_at,
    u.display_name,
    u.username,
    u.profile_visibility
  FROM stories s
  JOIN users u ON u.id = s.user_id
  WHERE s.expires_at > ?
  ORDER BY s.created_at DESC
  LIMIT 240
`)

const selectStoryByIdStmt = db.prepare(`
  SELECT
    id,
    user_id,
    title,
    description,
    media_url,
    media_type,
    metadata_json,
    reactions,
    views,
    comments,
    expires_at,
    created_at
  FROM stories
  WHERE id = ?
  LIMIT 1
`)

const upsertMusicTrackStmt = db.prepare(`
  INSERT INTO music_library (
    id,
    title,
    artist,
    genre,
    mood,
    duration_sec,
    preview_url,
    is_active,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    artist = excluded.artist,
    genre = excluded.genre,
    mood = excluded.mood,
    duration_sec = excluded.duration_sec,
    preview_url = excluded.preview_url,
    updated_at = excluded.updated_at
`)

const selectMusicTrackByIdStmt = db.prepare(`
  SELECT
    id,
    title,
    artist,
    genre,
    mood,
    duration_sec,
    preview_url,
    is_active,
    created_at,
    updated_at
  FROM music_library
  WHERE id = ?
  LIMIT 1
`)

const listMusicTracksStmt = db.prepare(`
  SELECT
    id,
    title,
    artist,
    genre,
    mood,
    duration_sec,
    preview_url,
    is_active,
    created_at,
    updated_at
  FROM music_library
  WHERE is_active = 1
  ORDER BY updated_at DESC, title ASC
  LIMIT ?
`)

const searchMusicTracksStmt = db.prepare(`
  SELECT
    id,
    title,
    artist,
    genre,
    mood,
    duration_sec,
    preview_url,
    is_active,
    created_at,
    updated_at
  FROM music_library
  WHERE is_active = 1
    AND (
      lower(title) LIKE ? ESCAPE '\\'
      OR lower(artist) LIKE ? ESCAPE '\\'
      OR lower(genre) LIKE ? ESCAPE '\\'
      OR lower(mood) LIKE ? ESCAPE '\\'
    )
  ORDER BY updated_at DESC, title ASC
  LIMIT ?
`)

const insertLiveStreamStmt = db.prepare(`
  INSERT INTO live_streams (
    id,
    owner_user_id,
    title,
    description,
    status,
    started_at,
    ended_at,
    created_at,
    updated_at
  ) VALUES (?, ?, ?, ?, 'active', ?, '', ?, ?)
`)

const selectActiveLiveSessionByOwnerStmt = db.prepare(`
  SELECT
    l.id,
    l.owner_user_id,
    l.title,
    l.description,
    l.status,
    l.started_at,
    l.ended_at,
    l.created_at,
    l.updated_at,
    u.username,
    u.display_name,
    u.avatar_url,
    u.profile_visibility
  FROM live_streams l
  JOIN users u ON u.id = l.owner_user_id
  WHERE l.owner_user_id = ? AND l.status = 'active'
  ORDER BY l.started_at DESC
  LIMIT 1
`)

const selectLiveSessionByIdStmt = db.prepare(`
  SELECT
    l.id,
    l.owner_user_id,
    l.title,
    l.description,
    l.status,
    l.started_at,
    l.ended_at,
    l.created_at,
    l.updated_at,
    u.username,
    u.display_name,
    u.avatar_url,
    u.profile_visibility
  FROM live_streams l
  JOIN users u ON u.id = l.owner_user_id
  WHERE l.id = ?
  LIMIT 1
`)

const listFollowingLiveSessionsStmt = db.prepare(`
  SELECT
    l.id,
    l.owner_user_id,
    l.title,
    l.description,
    l.status,
    l.started_at,
    l.ended_at,
    l.created_at,
    l.updated_at,
    u.username,
    u.display_name,
    u.avatar_url,
    u.profile_visibility
  FROM live_streams l
  JOIN users u ON u.id = l.owner_user_id
  LEFT JOIN follows f
    ON f.followed_user_id = l.owner_user_id
    AND f.follower_user_id = ?
  WHERE l.status = 'active'
    AND (l.owner_user_id = ? OR f.follower_user_id IS NOT NULL)
  ORDER BY l.started_at DESC
  LIMIT 80
`)

const stopLiveSessionStmt = db.prepare(`
  UPDATE live_streams
  SET status = 'ended', ended_at = ?, updated_at = ?
  WHERE id = ?
`)

const closeDanglingLiveSessionsStmt = db.prepare(`
  UPDATE live_streams
  SET status = 'ended', ended_at = ?, updated_at = ?
  WHERE status = 'active'
`)

const insertLiveRecordingStmt = db.prepare(`
  INSERT INTO live_recordings (
    id, owner_user_id, session_id, title, media_url, media_type, duration_sec, visibility, created_at, expires_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const selectLiveRecordingsByOwnerStmt = db.prepare(`
  SELECT id, owner_user_id, session_id, title, media_url, media_type, duration_sec, visibility, views, created_at, expires_at
  FROM live_recordings
  WHERE owner_user_id = ? AND expires_at > ?
  ORDER BY created_at DESC
  LIMIT 100
`)

const selectLiveRecordingByIdStmt = db.prepare(`
  SELECT id, owner_user_id, session_id, title, media_url, media_type, duration_sec, visibility, views, created_at, expires_at
  FROM live_recordings
  WHERE id = ?
  LIMIT 1
`)

const deleteLiveRecordingStmt = db.prepare(`DELETE FROM live_recordings WHERE id = ?`)

const selectExpiredLiveRecordingsStmt = db.prepare(`
  SELECT id, media_url FROM live_recordings WHERE expires_at <= ?
`)

const selectUserPostMetricsStmt = db.prepare(`
  SELECT
    COUNT(*) AS total_posts,
    COALESCE(SUM(reactions), 0) AS reactions_received,
    COALESCE(SUM(comments), 0) AS comments_received
  FROM posts
  WHERE user_id = ?
`)

const selectUserStoryMetricsStmt = db.prepare(`
  SELECT
    COUNT(*) AS total_stories,
    COALESCE(SUM(reactions), 0) AS story_reactions_received,
    COALESCE(SUM(CASE WHEN expires_at > ? THEN 1 ELSE 0 END), 0) AS active_stories
  FROM stories
  WHERE user_id = ?
`)

const selectUserSentCommentsCountStmt = db.prepare(`
  SELECT COUNT(*) AS total
  FROM post_comments
  WHERE user_id = ?
`)

const selectUserPostsByDayStmt = db.prepare(`
  SELECT
    SUBSTR(created_at, 1, 10) AS day_key,
    COUNT(*) AS total
  FROM posts
  WHERE user_id = ? AND created_at >= ?
  GROUP BY day_key
  ORDER BY day_key ASC
`)

const selectUserCommentsByDayStmt = db.prepare(`
  SELECT
    SUBSTR(created_at, 1, 10) AS day_key,
    COUNT(*) AS total
  FROM post_comments
  WHERE user_id = ? AND created_at >= ?
  GROUP BY day_key
  ORDER BY day_key ASC
`)

const updateStoryReactionsStmt = db.prepare(`
  UPDATE stories
  SET reactions = CASE
    WHEN reactions + ? < 0 THEN 0
    ELSE reactions + ?
  END
  WHERE id = ?
`)

const invalidateActiveVerificationCodesStmt = db.prepare(`
  UPDATE email_verification_codes
  SET consumed_at = ?
  WHERE user_id = ? AND consumed_at IS NULL
`)

const insertVerificationCodeStmt = db.prepare(`
  INSERT INTO email_verification_codes (
    id, user_id, code_hash, created_at, expires_at, consumed_at, attempts
  ) VALUES (?, ?, ?, ?, ?, NULL, 0)
`)

const selectLatestActiveVerificationCodeStmt = db.prepare(`
  SELECT id, user_id, code_hash, created_at, expires_at, consumed_at, attempts
  FROM email_verification_codes
  WHERE user_id = ? AND consumed_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1
`)

const markVerificationCodeConsumedStmt = db.prepare(`
  UPDATE email_verification_codes
  SET consumed_at = ?
  WHERE id = ?
`)

const incrementVerificationCodeAttemptsStmt = db.prepare(`
  UPDATE email_verification_codes
  SET attempts = attempts + 1
  WHERE id = ?
`)

const danglingLiveClosedAt = nowIso()
closeDanglingLiveSessionsStmt.run(danglingLiveClosedAt, danglingLiveClosedAt)
seedMusicLibrary()

function mapMusicTrackRow(row) {
  if (!row) return null

  return {
    id: row.id,
    title: row.title || 'Pista comunitaria',
    artist: row.artist || '',
    genre: row.genre || '',
    mood: row.mood || '',
    durationSec: toNumeric(row.duration_sec),
    previewUrl: row.preview_url || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

function normalizeStoryEditorMetadata(value) {
  const source = value && typeof value === 'object' ? value : {}
  const align = safeString(source.textAlign).toLowerCase()
  const filter = safeString(source.filter).toLowerCase()

  return {
    overlayText: safeString(source.overlayText).slice(0, 180),
    locationTag: safeString(source.locationTag).slice(0, 42),
    clockLabel: safeString(source.clockLabel).slice(0, 16),
    showClock: toBooleanFlag(source.showClock),
    textColor: normalizeHexColor(source.textColor),
    textSize: clampNumberInRange(source.textSize, 18, 58, 34),
    textPositionY: clampNumberInRange(source.textPositionY, 10, 86, 72),
    textAlign: ['left', 'center', 'right'].includes(align) ? align : 'center',
    filter: STORY_FILTER_NAMES.has(filter) ? filter : 'none',
  }
}

function normalizeStoryMusicMetadata(value) {
  const source = value && typeof value === 'object' ? value : null
  if (!source) return null

  const trackId = safeString(source.trackId)
  if (!trackId) return null

  const track = selectMusicTrackByIdStmt.get(trackId)
  if (!track || Number(track.is_active) !== 1) {
    return null
  }

  const mappedTrack = mapMusicTrackRow(track)
  if (!mappedTrack) return null

  const maxStart = Math.max(0, mappedTrack.durationSec || 0)

  return {
    trackId: mappedTrack.id,
    title: mappedTrack.title,
    artist: mappedTrack.artist,
    genre: mappedTrack.genre,
    mood: mappedTrack.mood,
    previewUrl: mappedTrack.previewUrl,
    durationSec: mappedTrack.durationSec,
    startSeconds: clampNumberInRange(source.startSeconds, 0, maxStart || 180, 0),
    volume: clampNumberInRange(source.volume, 0.05, 1, 0.82),
  }
}

function hasNonDefaultStoryEditor(editor) {
  if (!editor) return false

  return Boolean(
    editor.overlayText ||
    editor.locationTag ||
    editor.clockLabel ||
    editor.showClock ||
    editor.textColor !== '#ffffff' ||
    editor.textSize !== 34 ||
    editor.textPositionY !== 72 ||
    editor.textAlign !== 'center' ||
    editor.filter !== 'none',
  )
}

function parseStoryMetadataInput(value) {
  if (!value) return null

  let parsed = value

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null

    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') return null

  const editor = normalizeStoryEditorMetadata(parsed.editor)
  const music = normalizeStoryMusicMetadata(parsed.music)
  const normalizedEditor = hasNonDefaultStoryEditor(editor) ? editor : null

  if (!normalizedEditor && !music) {
    return null
  }

  return {
    editor: normalizedEditor,
    music,
  }
}

function storyMetadataToJson(value) {
  if (!value || typeof value !== 'object') return ''

  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function buildFriendPairKey(firstUserId, secondUserId) {
  const first = safeString(firstUserId)
  const second = safeString(secondUserId)
  if (!first || !second || first === second) return ''

  return first < second ? `${first}:${second}` : `${second}:${first}`
}

function areUsersFriends(firstUserId, secondUserId) {
  if (!firstUserId || !secondUserId) return false
  if (firstUserId === secondUserId) return true

  const pairKey = buildFriendPairKey(firstUserId, secondUserId)
  if (!pairKey) return false

  return Boolean(selectAcceptedFriendshipByPairStmt.get(pairKey))
}

function canViewerAccessUserContent(viewerUserId, ownerUserId, ownerVisibility) {
  const visibility = normalizeProfileVisibility(ownerVisibility)
  if (visibility === 'public') return true
  if (!viewerUserId || !ownerUserId) return false
  if (viewerUserId === ownerUserId) return true
  return areUsersFriends(viewerUserId, ownerUserId)
}

function resolveOptionalAuthUser(req) {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''
  if (!authorization.startsWith('Bearer ')) return null

  const token = authorization.slice('Bearer '.length).trim()
  if (!token) return null

  const payload = verifySessionToken(token)
  const userId = typeof payload?.sub === 'string' ? payload.sub : ''
  if (!userId) return null

  return selectUserByIdStmt.get(userId) || null
}

function generateVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashVerificationCode(code) {
  return createHash('sha256').update(code).digest('hex')
}

function getMediaLabel(mediaUrl, mediaType) {
  if (!mediaUrl) return 'Publicacion ciudadana'
  if (mediaType.startsWith('video/')) return 'Video ciudadano'
  if (mediaType.startsWith('audio/')) return 'Audio ciudadano'
  return 'Imagen ciudadana'
}

function mapPostRow(row, options = {}) {
  const location = row.location || 'Venezuela'
  const mediaType = row.media_type || ''
  const mediaUrl = row.media_url || ''

  return {
    id: row.id,
    ownerId: row.user_id,
    author: row.display_name || row.username || 'Tu voz ciudadana',
    meta: `reciente · ${location}`,
    tag: 'NUEVO',
    tagClass: mediaType.startsWith('video/') ? 'live' : 'historia',
    media: getMediaLabel(mediaUrl, mediaType),
    caption: row.caption || '',
    reactions: Number(row.reactions ?? 0),
    comments: Number(row.comments ?? 0),
    views: Number(row.views ?? 0),
    tone: 'new',
    mediaUrl,
    createdAt: row.created_at || nowIso(),
    location,
    likedByViewer: Boolean(options.likedByViewer),
  }
}

function mapStoryRow(row, options = {}) {
  const metadata = parseStoryMetadataInput(row.metadata_json)

  return {
    id: row.id,
    ownerId: row.user_id,
    author: row.display_name || row.username || 'Ciudadano VensuR',
    title: row.title,
    description: row.description || '',
    mediaUrl: row.media_url || '',
    mediaType: row.media_type || '',
    reactions: Number(row.reactions ?? 0),
    comments: Number(row.comments ?? 0),
    views: Number(row.views ?? 0),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    editor: metadata?.editor || undefined,
    music: metadata?.music || null,
    likedByViewer: Boolean(options.likedByViewer),
  }
}

function mapPostCommentRow(row) {
  return {
    id: row.id,
    postId: row.post_id,
    ownerId: row.user_id,
    author: row.display_name || row.username || 'Ciudadano VensuR',
    handle: row.username || '',
    text: row.text || '',
    createdAt: row.created_at || nowIso(),
  }
}

function detectCommentTopicFromPost(row) {
  const text = `${safeString(row?.caption)} ${safeString(row?.location)}`.toLowerCase()

  for (const rule of BOT_COMMENT_TOPIC_RULES) {
    if (rule.pattern.test(text)) {
      return rule.key
    }
  }

  return 'general'
}

function normalizeCommentSignature(value) {
  return safeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9|_-]/g, '')
}

function getBotTemplateMemory(userId) {
  const key = safeString(userId)
  if (!key) return []

  if (!botRuntime.commentTemplateMemoryByUser.has(key)) {
    botRuntime.commentTemplateMemoryByUser.set(key, [])
  }

  const memory = botRuntime.commentTemplateMemoryByUser.get(key)
  return Array.isArray(memory) ? memory : []
}

function rememberBotTemplateUsage(userId, signature) {
  const key = safeString(userId)
  const normalizedSignature = normalizeCommentSignature(signature)
  if (!key || !normalizedSignature) return

  const current = getBotTemplateMemory(key)
  const next = [normalizedSignature, ...current.filter((item) => item !== normalizedSignature)]
  next.length = Math.min(next.length, BOT_COMMENT_MEMORY_SIZE)
  botRuntime.commentTemplateMemoryByUser.set(key, next)
}

function pickCommentTemplateForBot(topic, userId) {
  const topicTemplates = BOT_COMMENT_TEMPLATES[topic]
  const templates = Array.isArray(topicTemplates) && topicTemplates.length
    ? topicTemplates
    : BOT_COMMENT_TEMPLATES.general

  const memory = getBotTemplateMemory(userId)
  const blocked = new Set(memory.slice(0, BOT_COMMENT_RECENT_BLOCK))

  const candidates = templates
    .map((template, index) => ({
      template,
      signature: normalizeCommentSignature(`${topic}|${index}|${template}`),
    }))
    .filter((item) => !blocked.has(item.signature))

  const picked = pickRandom(candidates.length ? candidates : templates.map((template, index) => ({
    template,
    signature: normalizeCommentSignature(`${topic}|${index}|${template}`),
  })))

  return picked || {
    template: 'Seguimos monitoreando esta publicacion en conjunto con la comunidad.',
    signature: normalizeCommentSignature(`${topic}|fallback`),
  }
}

function buildPostCitation(row) {
  const caption = safeString(row?.caption).replace(/\s+/g, ' ')
  if (!caption) return ''

  const candidate = caption.length > 88 ? `${caption.slice(0, 85).trim()}...` : caption
  return `"${candidate}"`
}

function buildZoneCommentContext(location) {
  const normalizedLocation = safeString(location)
  if (!normalizedLocation) {
    return 'Desde la red nacional seguimos validando reportes en conjunto.'
  }

  const rule = BOT_ZONE_RULES.find((item) => item.pattern.test(normalizedLocation))
  if (rule) {
    return rule.sentence
  }

  return `En ${normalizedLocation} mantenemos coordinacion comunitaria para verificar novedades.`
}

function clampCommentText(value, maxLength = 255) {
  const text = safeString(value).replace(/\s+/g, ' ')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3).trim()}...`
}

function normalizeBotBehavior(input = {}) {
  const requestedMode = normalizeMode(input.mode ?? BOT_ACTIVITY_MODE)
  const base = BOT_ACTIVITY_PRESETS[requestedMode] || BOT_ACTIVITY_PRESETS.normal

  const commentBurstMin = clampBurst(input.commentBurstMin, base.commentBurstMin)
  const commentBurstMax = clampBurst(input.commentBurstMax, base.commentBurstMax)
  const postReactionBurstMin = clampBurst(input.postReactionBurstMin, base.postReactionBurstMin)
  const postReactionBurstMax = clampBurst(input.postReactionBurstMax, base.postReactionBurstMax)
  const storyReactionBurstMin = clampBurst(input.storyReactionBurstMin, base.storyReactionBurstMin)
  const storyReactionBurstMax = clampBurst(input.storyReactionBurstMax, base.storyReactionBurstMax)

  return {
    mode: requestedMode,
    createPostChance: clampChance(input.createPostChance, base.createPostChance),
    createStoryChance: clampChance(input.createStoryChance, base.createStoryChance),
    preferVideoPostChance: clampChance(input.preferVideoPostChance, base.preferVideoPostChance),
    preferVideoStoryChance: clampChance(input.preferVideoStoryChance, base.preferVideoStoryChance),
    collaborativePairChance: clampChance(input.collaborativePairChance, base.collaborativePairChance),
    commentBurstMin: Math.min(commentBurstMin, commentBurstMax),
    commentBurstMax: Math.max(commentBurstMin, commentBurstMax),
    postReactionBurstMin: Math.min(postReactionBurstMin, postReactionBurstMax),
    postReactionBurstMax: Math.max(postReactionBurstMin, postReactionBurstMax),
    storyReactionBurstMin: Math.min(storyReactionBurstMin, storyReactionBurstMax),
    storyReactionBurstMax: Math.max(storyReactionBurstMin, storyReactionBurstMax),
  }
}

function buildInitialBotBehavior() {
  return normalizeBotBehavior({
    mode: BOT_ACTIVITY_MODE,
  })
}

function randomIntInRange(minValue, maxValue) {
  const min = Math.max(1, Math.trunc(minValue))
  const max = Math.max(min, Math.trunc(maxValue))
  return randomInt(min, max + 1)
}

function buildContextualBotComment(row, options = {}) {
  const userId = safeString(options?.userId)
  const topic = detectCommentTopicFromPost(row)
  const picked = pickCommentTemplateForBot(topic, userId)
  const template = picked.template
  const location = safeString(row?.location) || 'la zona'
  const normalizedCaption = safeString(row?.caption).toLowerCase()

  const anchorsByTopic = {
    energia: 'falla de servicios',
    represion: 'operativo y detenciones',
    corrupcion: 'irregularidades y corrupcion',
    violencia: 'riesgo y violencia',
    general: 'alerta comunitaria',
  }

  const fallbackAnchor = anchorsByTopic[topic] || anchorsByTopic.general

  const dynamicAnchor = BOT_DARK_TOPIC_KEYWORDS.find(
    (keyword) => keyword.length >= 5 && normalizedCaption.includes(keyword),
  )

  const anchor = dynamicAnchor || fallbackAnchor
  const citation = buildPostCitation(row)
  const zoneContext = buildZoneCommentContext(location)
  const commentText = clampCommentText(
    `${template.replaceAll('{location}', location)} ${zoneContext} Punto clave: ${anchor}. ${citation ? `Cita del post: ${citation}.` : ''}`,
  )

  rememberBotTemplateUsage(userId, picked.signature)
  return commentText
}

function createPostComment({ postId, userId, text }) {
  const cleanText = safeString(text).slice(0, 260)
  if (!postId || !userId || !cleanText) return null

  const commentId = nanoid()
  const createdAt = nowIso()
  insertPostCommentStmt.run(commentId, postId, userId, cleanText, createdAt)
  incrementPostCommentsStmt.run(createdAt, postId)

  const rows = selectPostCommentsStmt.all(postId)
  const created = rows.find((row) => row.id === commentId)
  return created ? mapPostCommentRow(created) : null
}

function pickRandom(items) {
  if (!Array.isArray(items) || !items.length) return null
  return items[randomInt(0, items.length)]
}

function getLikedPostIdSet(userId) {
  if (!userId) return new Set()
  return new Set(selectLikedPostIdsByUserStmt.all(userId).map((row) => row.post_id))
}

function getLikedStoryIdSet(userId) {
  if (!userId) return new Set()
  return new Set(selectLikedStoryIdsByUserStmt.all(userId).map((row) => row.story_id))
}

/**
 * Aplica una reaccion real (por usuario) de forma idempotente y mantiene el contador visible.
 * @returns {{ liked: boolean, changed: boolean }}
 */
const togglePostReactionTx = db.transaction((postId, userId, intent) => {
  const alreadyLiked = Boolean(selectPostReactionStmt.get(postId, userId))
  const now = nowIso()

  // intent > 0 => quiere dar like; intent < 0 => quiere quitar; intent === 0 => alterna.
  const wantsLike = intent > 0 ? true : intent < 0 ? false : !alreadyLiked

  if (wantsLike && !alreadyLiked) {
    insertPostReactionStmt.run(postId, userId, now)
    updatePostReactionsStmt.run(1, 1, now, postId)
    return { liked: true, changed: true }
  }

  if (!wantsLike && alreadyLiked) {
    deletePostReactionStmt.run(postId, userId)
    updatePostReactionsStmt.run(-1, -1, now, postId)
    return { liked: false, changed: true }
  }

  return { liked: alreadyLiked, changed: false }
})

const toggleStoryReactionTx = db.transaction((storyId, userId, intent) => {
  const alreadyLiked = Boolean(selectStoryReactionStmt.get(storyId, userId))
  const now = nowIso()
  const wantsLike = intent > 0 ? true : intent < 0 ? false : !alreadyLiked

  if (wantsLike && !alreadyLiked) {
    insertStoryReactionStmt.run(storyId, userId, now)
    updateStoryReactionsStmt.run(1, 1, storyId)
    return { liked: true, changed: true }
  }

  if (!wantsLike && alreadyLiked) {
    deleteStoryReactionStmt.run(storyId, userId)
    updateStoryReactionsStmt.run(-1, -1, storyId)
    return { liked: false, changed: true }
  }

  return { liked: alreadyLiked, changed: false }
})

function buildBotSvgAsset({ title, subtitle, colorA, colorB }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" role="img" aria-labelledby="title desc">
  <title>${escapeXml(title)}</title>
  <desc>${escapeXml(subtitle)}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${escapeXml(colorA)}"/>
      <stop offset="100%" stop-color="${escapeXml(colorB)}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>
  <g opacity="0.18" stroke="#ffffff" stroke-width="2">
    <path d="M-120 260 L1320 260"/>
    <path d="M-120 420 L1320 420"/>
    <path d="M-120 580 L1320 580"/>
    <path d="M-120 740 L1320 740"/>
    <path d="M-120 900 L1320 900"/>
  </g>
  <g fill="#ffffff">
    <text x="80" y="980" font-family="Arial, sans-serif" font-size="48" font-weight="700" letter-spacing="2">${escapeXml(title.toUpperCase())}</text>
    <text x="80" y="1040" font-family="Arial, sans-serif" font-size="30" font-weight="500" opacity="0.92">${escapeXml(subtitle)}</text>
  </g>
</svg>
`
}

function buildTonePreviewWavBuffer({ frequency, durationSec, sampleRate = 22050 }) {
  const duration = Math.max(2, Math.min(90, Number(durationSec) || 30))
  const toneHz = Math.max(80, Math.min(1200, Number(frequency) || 220))
  const channels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const totalSamples = Math.max(1, Math.floor(sampleRate * duration))
  const dataSize = totalSamples * blockAlign
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / sampleRate
    const attack = Math.min(1, index / (sampleRate * 0.04))
    const release = Math.min(1, (totalSamples - index) / (sampleRate * 0.36))
    const envelope = Math.max(0, Math.min(1, attack * release))
    const base = Math.sin(2 * Math.PI * toneHz * time)
    const harmonic = Math.sin(2 * Math.PI * toneHz * 2 * time) * 0.18
    const texture = Math.sin(2 * Math.PI * toneHz * 0.5 * time) * 0.09
    const sample = Math.max(-1, Math.min(1, (base * 0.42 + harmonic + texture) * envelope))
    const int16 = Math.trunc(sample * 32767)
    buffer.writeInt16LE(int16, 44 + index * bytesPerSample)
  }

  return buffer
}

function ensureMusicPreviewAssets() {
  const previewMap = new Map()

  for (const track of MUSIC_LIBRARY_SEED) {
    const trackId = safeString(track.id)
    if (!trackId) continue

    const fileName = `${trackId}.wav`
    const targetPath = path.join(UPLOADS_DIR, fileName)

    if (!existsSync(targetPath)) {
      const buffer = buildTonePreviewWavBuffer({
        frequency: track.toneHz,
        durationSec: track.durationSec,
      })
      writeFileSync(targetPath, buffer)
    }

    previewMap.set(trackId, `/uploads/${fileName}`)
  }

  return previewMap
}

function seedMusicLibrary() {
  const previewMap = ensureMusicPreviewAssets()
  const now = nowIso()

  for (const track of MUSIC_LIBRARY_SEED) {
    const trackId = safeString(track.id)
    if (!trackId) continue

    const title = safeString(track.title).slice(0, 80) || 'Pista comunitaria'
    const artist = safeString(track.artist).slice(0, 80) || 'Archivo VensuR'
    const genre = safeString(track.genre).slice(0, 40)
    const mood = safeString(track.mood).slice(0, 40)
    const durationSec = Math.max(8, Math.min(180, Math.trunc(toNumeric(track.durationSec) || 30)))
    const previewUrl = previewMap.get(trackId) || ''

    upsertMusicTrackStmt.run(trackId, title, artist, genre, mood, durationSec, previewUrl, now, now)
  }
}

function ensureBotMediaAssets() {
  for (const media of BOT_MEDIA_LIBRARY) {
    const targetPath = path.join(UPLOADS_DIR, media.filename)
    if (existsSync(targetPath)) continue

    const svg = buildBotSvgAsset(media)
    writeFileSync(targetPath, svg, 'utf8')
  }
}

function syncPublicMediaToUploads() {
  if (!existsSync(PUBLIC_DIR)) return 0

  let copiedCount = 0
  const pendingDirs = [PUBLIC_DIR]

  try {
    while (pendingDirs.length) {
      const currentDir = pendingDirs.pop()
      if (!currentDir) continue

      const entries = readdirSync(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        const absolutePath = path.join(currentDir, entry.name)

        if (entry.isDirectory()) {
          pendingDirs.push(absolutePath)
          continue
        }

        if (!entry.isFile()) continue

        const mediaType = inferMediaTypeFromUrl(entry.name)
        if (!mediaType.startsWith('image/') && !mediaType.startsWith('video/')) {
          continue
        }

        const extension = path.extname(entry.name).toLowerCase() || (mediaType.startsWith('video/') ? '.mp4' : '.jpg')
        const relativePath = path.relative(PUBLIC_DIR, absolutePath).split(path.sep).join('/').toLowerCase()
        const stableHash = createHash('sha1').update(relativePath).digest('hex').slice(0, 16)
        const targetFileName = `${PUBLIC_MEDIA_FILE_PREFIX}${stableHash}${extension}`
        const targetPath = path.join(UPLOADS_DIR, targetFileName)

        if (existsSync(targetPath)) continue

        copyFileSync(absolutePath, targetPath)
        copiedCount += 1
      }
    }
  } catch {
    return copiedCount
  }

  return copiedCount
}

function findBotMediaByKey(mediaKey) {
  return BOT_MEDIA_LIBRARY.find((item) => item.key === mediaKey) ?? BOT_MEDIA_LIBRARY[0]
}

function isVideoMediaUrl(url) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
}

function isImageMediaUrl(url) {
  return /\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)(\?|$)/i.test(url)
}

function inferMediaTypeFromUrl(url) {
  const normalized = safeString(url).toLowerCase()
  if (!normalized) return ''

  if (/\.mp4(\?|$)/.test(normalized)) return 'video/mp4'
  if (/\.webm(\?|$)/.test(normalized)) return 'video/webm'
  if (/\.mov(\?|$)/.test(normalized)) return 'video/quicktime'
  if (/\.m4v(\?|$)/.test(normalized)) return 'video/x-m4v'

  if (/\.jpg(\?|$)|\.jpeg(\?|$)/.test(normalized)) return 'image/jpeg'
  if (/\.png(\?|$)/.test(normalized)) return 'image/png'
  if (/\.webp(\?|$)/.test(normalized)) return 'image/webp'
  if (/\.gif(\?|$)/.test(normalized)) return 'image/gif'
  if (/\.avif(\?|$)/.test(normalized)) return 'image/avif'
  if (/\.bmp(\?|$)/.test(normalized)) return 'image/bmp'
  if (/\.svg(\?|$)/.test(normalized)) return 'image/svg+xml'

  return ''
}

// Hosts que bloquean el hotlinking o firman las URLs (caducan -> 403 en el navegador).
const BLOCKED_MEDIA_HOST_PATTERNS = [/(^|\.)images-worker\./i, /(^|\.)cdn-images\./i]

function isUsableExternalMediaUrl(urlValue) {
  try {
    const parsed = new URL(urlValue)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    if (BLOCKED_MEDIA_HOST_PATTERNS.some((pattern) => pattern.test(parsed.hostname))) return false
    // URLs firmadas: caducan y devuelven 403 poco después.
    for (const key of parsed.searchParams.keys()) {
      const lower = key.toLowerCase()
      if (lower === 'sig' || lower === 'signature' || lower === 'expires' || lower === 'exp' || lower === 'token') {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function normalizeMediaUrl(rawUrl, baseUrl) {
  const decoded = safeString(rawUrl).replaceAll('&amp;', '&')
  if (!decoded) return ''

  try {
    const resolved = new URL(decoded, baseUrl).toString()
    return isUsableExternalMediaUrl(resolved) ? resolved : ''
  } catch {
    return ''
  }
}

function isDarkTopicChunk(chunk) {
  const text = safeString(chunk).toLowerCase()
  if (!text) return false

  return BOT_DARK_TOPIC_KEYWORDS.some((keyword) => text.includes(keyword))
}

function splitRssItems(xmlText) {
  const items = xmlText.match(/<item[\s\S]*?<\/item>/gi)
  if (Array.isArray(items) && items.length) return items

  const entries = xmlText.match(/<entry[\s\S]*?<\/entry>/gi)
  if (Array.isArray(entries) && entries.length) return entries

  return [xmlText]
}

function extractMediaUrlsFromRss(xmlText, sourceUrl) {
  const patterns = [
    /<enclosure[^>]+url=["']([^"']+)["'][^>]*>/gi,
    /<media:content[^>]+url=["']([^"']+)["'][^>]*>/gi,
    /<media:thumbnail[^>]+url=["']([^"']+)["'][^>]*>/gi,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
  ]

  const out = []
  const chunks = splitRssItems(xmlText)

  for (const chunk of chunks) {
    if (!isDarkTopicChunk(chunk)) continue

    for (const pattern of patterns) {
      const regex = new RegExp(pattern)
      let match = regex.exec(chunk)

      while (match) {
        const absoluteUrl = normalizeMediaUrl(match[1], sourceUrl)
        const mediaType = inferMediaTypeFromUrl(absoluteUrl)

        if (mediaType) {
          out.push({
            url: absoluteUrl,
            mediaType,
            kind: mediaType.startsWith('video/') ? 'video' : 'image',
            source: sourceUrl,
          })
        }

        match = regex.exec(chunk)
      }
    }
  }

  return out
}

async function fetchBotFeedMedia(feedUrl) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, RSS_PROXY_TIMEOUT_MS)

  try {
    const response = await fetch(feedUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'VensuR-Bots-Media/1.0',
      },
    })

    if (!response.ok) return []

    const xmlText = await response.text()
    return extractMediaUrlsFromRss(xmlText, feedUrl)
  } catch {
    return []
  } finally {
    clearTimeout(timeoutId)
  }
}

async function collectFeedMediaPool() {
  const results = await Promise.all(BOT_RSS_MEDIA_FEEDS.map((feedUrl) => fetchBotFeedMedia(feedUrl)))
  return results.flat()
}

function collectLocalUploadsMediaPool() {
  try {
    const files = readdirSync(UPLOADS_DIR)

    return files
      .map((fileName) => {
        const mediaType = inferMediaTypeFromUrl(fileName)
        if (!mediaType) return null

        const kind = mediaType.startsWith('video/')
          ? 'video'
          : mediaType.startsWith('image/')
            ? 'image'
            : ''

        if (!kind) return null

        return {
          url: `/uploads/${fileName}`,
          mediaType,
          kind,
          source: 'local-uploads',
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

async function refreshBotMediaPool() {
  const [feedMedia, localUploads] = await Promise.all([
    collectFeedMediaPool(),
    Promise.resolve(collectLocalUploadsMediaPool()),
  ])

  const merged = []
  const seen = new Set()

  for (const item of [...feedMedia, ...localUploads]) {
    if (!item?.url || !item?.mediaType) continue

    const normalizedUrl = safeString(item.url)
    if (!normalizedUrl || seen.has(normalizedUrl)) continue

    const isVideo = item.mediaType.startsWith('video/') || isVideoMediaUrl(normalizedUrl)
    const isImage = item.mediaType.startsWith('image/') || isImageMediaUrl(normalizedUrl)
    if (!isVideo && !isImage) continue

    merged.push({
      url: normalizedUrl,
      mediaType: item.mediaType,
      kind: isVideo ? 'video' : 'image',
      source: item.source || 'unknown',
    })
    seen.add(normalizedUrl)

    if (merged.length >= Math.max(40, BOT_MEDIA_POOL_LIMIT)) {
      break
    }
  }

  const images = merged.filter((item) => item.kind === 'image')
  const videos = merged.filter((item) => item.kind === 'video')

  botRuntime.mediaPool = {
    images,
    videos,
    total: merged.length,
    refreshedAt: nowIso(),
  }
}

function pickBotMedia(entry, options = {}) {
  const { preferVideo = false, preferImage = false } = options
  const videos = botRuntime.mediaPool.videos
  const images = botRuntime.mediaPool.images

  if (preferVideo && videos.length) {
    return pickRandom(videos)
  }

  if (preferImage && images.length) {
    return pickRandom(images)
  }

  const mixedPool = [...images, ...videos]
  if (mixedPool.length) {
    return pickRandom(mixedPool)
  }

  const fallbackAsset = findBotMediaByKey(entry?.profile?.mediaKey)
  if (!fallbackAsset) return null

  return {
    url: `/uploads/${fallbackAsset.filename}`,
    mediaType: 'image/svg+xml',
    kind: 'image',
    source: 'fallback-svg',
  }
}

function ensureBotUsers() {
  const now = nowIso()

  return BOT_PROFILES.map((profile) => {
    const existing = selectUserByEmailStmt.get(profile.email)
    const mediaAsset = findBotMediaByKey(profile.mediaKey)
    const avatarUrl = mediaAsset ? `/uploads/${mediaAsset.filename}` : ''

    if (existing) {
      const nextDisplayName = profile.displayName
      const nextAvatar = avatarUrl || existing.avatar_url
      const nextVerified = 1

      updateUserSocialDetailsStmt.run(nextDisplayName, nextVerified, nextAvatar, now, existing.id)
      updateUserVisibilityStmt.run('public', now, existing.id)
      return {
        profile,
        user: selectUserByIdStmt.get(existing.id),
      }
    }

    const safeUsername = selectUserByUsernameStmt.get(profile.username)
      ? makeUniqueUsername(profile.username)
      : profile.username

    const userId = nanoid()
    insertUserStmt.run(
      userId,
      profile.email,
      safeUsername,
      profile.displayName,
      SOCIAL_PASSWORD_SENTINEL,
      '',
      '',
      1,
      avatarUrl,
      '',
      now,
      now,
    )

    updateUserVisibilityStmt.run('public', now, userId)

    return {
      profile,
      user: selectUserByIdStmt.get(userId),
    }
  }).filter((entry) => Boolean(entry.user))
}

function createBotPost(entry, options = {}) {
  if (!entry?.user || !entry?.profile) return null

  const mediaItem = pickBotMedia(entry, options)
  if (!mediaItem?.url) return null

  const location = pickRandom(BOT_LOCATIONS) || entry.profile.defaultLocation || 'Venezuela'
  const caption = pickRandom(BOT_POST_CAPTIONS) || 'Actualizacion automatica de la comunidad.'
  const now = nowIso()
  const postId = nanoid()

  insertPostStmt.run(
    postId,
    entry.user.id,
    caption,
    mediaItem.url,
    mediaItem.mediaType,
    location,
    randomInt(0, 7),
    0,
    now,
    now,
  )

  return postId
}

function createBotStory(entry, options = {}) {
  if (!entry?.user || !entry?.profile) return null

  const mediaItem = pickBotMedia(entry, options)
  if (!mediaItem?.url) return null

  const fallbackAsset = findBotMediaByKey(entry.profile.mediaKey)
  const storyTitle = fallbackAsset?.title || buildStoryTitleFromCaption(entry.profile.displayName)

  return createStoryFromUploadedMedia({
    userId: entry.user.id,
    title: storyTitle,
    description: pickRandom(BOT_STORY_CAPTIONS) || 'Historia automatica.',
    mediaUrl: mediaItem.url,
    mediaType: mediaItem.mediaType,
  })
}

function createBotComment(entry, options = {}) {
  if (!entry?.user?.id) return null

  const preferredPostId = safeString(options?.postId)
  const preferredPost = preferredPostId ? selectPostByIdStmt.get(preferredPostId) : null

  const availablePosts = selectPostsStmt
    .all()
    .filter((row) => row.user_id !== entry.user.id)
    .filter((row) => canViewerAccessUserContent(entry.user.id, row.user_id, row.profile_visibility))

  const topicalPosts = availablePosts.filter((row) => detectCommentTopicFromPost(row) !== 'general')
  const pool = topicalPosts.length ? topicalPosts : availablePosts
  const canUsePreferredPost = Boolean(
    preferredPost &&
    preferredPost.user_id !== entry.user.id &&
    canViewerAccessUserContent(entry.user.id, preferredPost.user_id, preferredPost.profile_visibility),
  )

  const targetPost =
    canUsePreferredPost
      ? preferredPost
      : pickRandom(pool) || null
  if (!targetPost?.id) return null

  const text = buildContextualBotComment(targetPost, {
    userId: entry.user.id,
  })
  return createPostComment({
    postId: targetPost.id,
    userId: entry.user.id,
    text,
  })
}

function createCollaborativeBotComments(entry, options = {}) {
  const preferredPostId = safeString(options?.postId)
  const forcePair = toBooleanFlag(options?.forcePair)
  const behavior = normalizeBotBehavior(options?.behavior || botRuntime.behavior)

  const primary = createBotComment(entry, {
    postId: preferredPostId,
  })

  const out = primary ? [primary] : []
  const shouldPair = forcePair || Math.random() < behavior.collaborativePairChance
  if (!shouldPair) return out

  const targetPostId = primary?.postId || preferredPostId
  if (!targetPostId) return out

  const collaborators = botRuntime.users.filter((candidate) => candidate?.user?.id && candidate.user.id !== entry.user.id)
  const collaborator = pickRandom(collaborators)
  if (!collaborator) return out

  const secondary = createBotComment(collaborator, {
    postId: targetPostId,
  })

  if (secondary) {
    out.push(secondary)
  }

  return out
}

function reactToRandomPost(viewerUserId = '') {
  const rows = selectPostsStmt
    .all()
    .filter((row) => canViewerAccessUserContent(viewerUserId, row.user_id, row.profile_visibility))
  if (!rows.length) return null

  const target = pickRandom(rows)
  if (!target?.id) return null

  const delta = randomInt(1, 3)
  updatePostReactionsStmt.run(delta, delta, nowIso(), target.id)

  return target.id
}

function reactToRandomPosts(burst = 1, viewerUserId = '') {
  const count = Math.max(1, Math.trunc(burst))
  const ids = []

  for (let index = 0; index < count; index += 1) {
    const id = reactToRandomPost(viewerUserId)
    if (id) {
      ids.push(id)
    }
  }

  return ids
}

function reactToRandomStory(viewerUserId = '') {
  const rows = selectActiveStoriesStmt
    .all(nowIso())
    .filter((row) => canViewerAccessUserContent(viewerUserId, row.user_id, row.profile_visibility))
  if (!rows.length) return null

  const target = pickRandom(rows)
  if (!target?.id) return null

  const delta = randomInt(1, 3)
  updateStoryReactionsStmt.run(delta, delta, target.id)

  return target.id
}

function reactToRandomStories(burst = 1, viewerUserId = '') {
  const count = Math.max(1, Math.trunc(burst))
  const ids = []

  for (let index = 0; index < count; index += 1) {
    const id = reactToRandomStory(viewerUserId)
    if (id) {
      ids.push(id)
    }
  }

  return ids
}

function runBotsTick({ forceCreate = false } = {}) {
  if (!BOTS_ENABLED || !botRuntime.users.length) {
    return {
      enabled: BOTS_ENABLED,
      tick: botRuntime.ticks,
      createdPostId: null,
      createdStoryId: null,
      reactedPostId: null,
      reactedStoryId: null,
      actor: null,
    }
  }

  const actor = pickRandom(botRuntime.users)
  if (!actor) {
    return {
      enabled: BOTS_ENABLED,
      tick: botRuntime.ticks,
      createdPostId: null,
      createdStoryId: null,
      reactedPostId: null,
      reactedStoryId: null,
      actor: null,
    }
  }

  const behavior = normalizeBotBehavior(botRuntime.behavior)
  const shouldCreatePost = forceCreate || Math.random() < behavior.createPostChance
  const shouldCreateStory = forceCreate || Math.random() < behavior.createStoryChance
  const preferVideoPost = Math.random() < behavior.preferVideoPostChance
  const preferVideoStory = Math.random() < behavior.preferVideoStoryChance

  const createdPostId = shouldCreatePost
    ? createBotPost(actor, { preferVideo: preferVideoPost })
    : null
  const story = shouldCreateStory
    ? createBotStory(actor, { preferVideo: preferVideoStory })
    : null
  const commentBurst = randomIntInRange(behavior.commentBurstMin, behavior.commentBurstMax)
  const comments = []

  for (let burstIndex = 0; burstIndex < commentBurst; burstIndex += 1) {
    const batch = createCollaborativeBotComments(actor, {
      postId: createdPostId,
      behavior,
    })

    if (batch.length) {
      comments.push(...batch)
    }
  }

  const postReactionBurst = randomIntInRange(behavior.postReactionBurstMin, behavior.postReactionBurstMax)
  const postReactions = reactToRandomPosts(postReactionBurst, actor.user.id)

  if (!postReactions.length) {
    createBotPost(actor, { preferImage: true })
    postReactions.push(...reactToRandomPosts(postReactionBurst, actor.user.id))
  }

  const storyReactionBurst = randomIntInRange(behavior.storyReactionBurstMin, behavior.storyReactionBurstMax)
  const storyReactions = reactToRandomStories(storyReactionBurst, actor.user.id)

  if (!storyReactions.length) {
    createBotStory(actor, { preferImage: true })
    storyReactions.push(...reactToRandomStories(storyReactionBurst, actor.user.id))
  }

  botRuntime.ticks += 1
  botRuntime.lastTickAt = nowIso()

  return {
    enabled: BOTS_ENABLED,
    tick: botRuntime.ticks,
    mode: behavior.mode,
    createdPostId,
    createdStoryId: story?.id ?? null,
    reactedPostId: postReactions[0] ?? null,
    reactedStoryId: storyReactions[0] ?? null,
    postReactions: postReactions.length,
    storyReactions: storyReactions.length,
    commentedPostId: comments[0]?.postId ?? null,
    collaborativeComments: comments.length,
    actor: actor.profile.displayName,
  }
}

async function startBotsAutomation() {
  if (!BOTS_ENABLED) {
    console.log('Bots desactivados. Define BOTS_ENABLED=true para activarlos.')
    return
  }

  ensureBotMediaAssets()
  const copiedFromPublic = syncPublicMediaToUploads()

  if (copiedFromPublic > 0) {
    console.log(`[Bots] media importada desde public: ${copiedFromPublic} archivos`)
  }

  botRuntime.users = ensureBotUsers()

  if (!botRuntime.users.length) {
    console.log('No se pudieron inicializar usuarios bot.')
    return
  }

  await refreshBotMediaPool()
  const hasVideoPool = botRuntime.mediaPool.videos.length > 0

  if (BOTS_BOOTSTRAP_CONTENT) {
    for (const entry of botRuntime.users) {
      const imagePostId = createBotPost(entry, { preferImage: true })

      if (hasVideoPool) {
        createBotPost(entry, { preferVideo: true })
      }

      createBotStory(entry, { preferImage: true })
      createBotComment(entry, { postId: imagePostId })
    }
  }

  const firstSummary = runBotsTick({ forceCreate: true })
  console.log('[Bots] ciclo inicial', firstSummary)

  botRuntime.timerId = setInterval(() => {
    const summary = runBotsTick()
    console.log('[Bots] tick', summary)
  }, Math.max(15_000, BOTS_TICK_INTERVAL_MS))

  console.log(
    `Bots activos: ${botRuntime.users.length}/${BOT_USER_COUNT} · intervalo ${Math.max(15_000, BOTS_TICK_INTERVAL_MS)}ms · media real ${botRuntime.mediaPool.images.length} fotos / ${botRuntime.mediaPool.videos.length} videos`,
  )
}

function requireBotControl(req, res, next) {
  if (!BOT_CONTROL_TOKEN) {
    next()
    return
  }

  const token = typeof req.headers['x-bot-token'] === 'string' ? req.headers['x-bot-token'] : ''
  if (token !== BOT_CONTROL_TOKEN) {
    sendError(res, 401, 'No autorizado para controlar bots.')
    return
  }

  next()
}

function createStoryFromUploadedMedia({ userId, title, description, mediaUrl, mediaType, metadata = null }) {
  const storyId = nanoid()
  const createdAt = nowIso()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const metadataJson = storyMetadataToJson(parseStoryMetadataInput(metadata))

  insertStoryStmt.run(
    storyId,
    userId,
    title,
    description,
    mediaUrl,
    mediaType,
    metadataJson,
    0,
    expiresAt,
    createdAt,
  )

  const story = selectStoryByIdStmt.get(storyId)
  return story ? mapStoryRow(story) : null
}

function normalizeRssUrl(rawUrl) {
  const value = safeString(rawUrl)
  if (!value) return ''

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function isAllowedRssUrl(urlValue) {
  try {
    const parsed = new URL(urlValue)
    const host = parsed.hostname.toLowerCase()

    return ALLOWED_RSS_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}

function listLinkedProviders(userId) {
  const rows = listSocialProvidersByUserStmt.all(userId)
  return rows.map((row) => row.provider)
}

function mapUserRow(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio || '',
    phone: row.phone || '',
    profileVisibility: normalizeProfileVisibility(row.profile_visibility),
    emailVerified: Boolean(row.email_verified),
    avatarUrl: row.avatar_url || '',
    coverUrl: row.cover_url || '',
    linkedProviders: listLinkedProviders(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapDirectoryUserRow(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    bio: safeString(row.bio).slice(0, 140),
    avatarUrl: row.avatar_url || '',
    coverUrl: row.cover_url || '',
    profileVisibility: normalizeProfileVisibility(row.profile_visibility),
    createdAt: row.created_at || '',
  }
}

function countFollowersForUser(userId) {
  return toNumeric(countFollowersByUserStmt.get(userId)?.total)
}

function countFollowingForUser(userId) {
  return toNumeric(countFollowingByUserStmt.get(userId)?.total)
}

function isUserFollowing(viewerUserId, targetUserId) {
  if (!viewerUserId || !targetUserId || viewerUserId === targetUserId) return false
  return Boolean(selectFollowRelationStmt.get(viewerUserId, targetUserId))
}

function canViewerJoinLiveSession(viewerUserId, ownerUserId) {
  if (!viewerUserId || !ownerUserId) return false
  if (viewerUserId === ownerUserId) return true
  return isUserFollowing(viewerUserId, ownerUserId)
}

function normalizeSdp(rawSdp) {
  if (typeof rawSdp !== 'string') return ''
  const trimmed = rawSdp.trim()
  if (!trimmed) return ''
  // El SDP de WebRTC exige que TODAS las líneas terminen en CRLF, incluida la última.
  // Un .trim() a secas rompe la última línea -> "Invalid SDP line" en setRemoteDescription.
  return `${trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')}\r\n`
}

function normalizeRtcSessionDescription(value, expectedType) {
  const type = safeString(value?.type).toLowerCase()
  const sdp = normalizeSdp(value?.sdp)

  if (!type || !sdp) return null
  if (type !== expectedType) return null
  if (sdp.length > 200_000) return null

  return { type, sdp }
}

function ensureLiveRuntimeSession(sessionId) {
  const key = safeString(sessionId)
  if (!key) return null

  if (!liveRuntime.sessions.has(key)) {
    liveRuntime.sessions.set(key, {
      offersByViewerId: new Map(),
      endedAt: '',
    })
  }

  return liveRuntime.sessions.get(key)
}

function markLiveViewerLeft(sessionId, viewerId, leftAt = nowIso()) {
  const runtime = ensureLiveRuntimeSession(sessionId)
  if (!runtime) return null

  const entry = runtime.offersByViewerId.get(viewerId)
  if (!entry) return null

  entry.leftAt = leftAt
  entry.lastSeenAt = leftAt
  runtime.offersByViewerId.set(viewerId, entry)
  return entry
}

function pruneLiveRuntimeSession(sessionId) {
  const runtime = liveRuntime.sessions.get(sessionId)
  if (!runtime) return

  const now = Date.now()

  for (const [viewerId, entry] of runtime.offersByViewerId.entries()) {
    const createdAt = parseIsoTimestamp(entry.createdAt)
    const leftAt = parseIsoTimestamp(entry.leftAt)
    const lastSeenAt = parseIsoTimestamp(entry.lastSeenAt || entry.answeredAt || entry.createdAt)

    if (!entry.answer && createdAt > 0 && now - createdAt > LIVE_STREAM_PENDING_OFFER_TTL_MS) {
      runtime.offersByViewerId.delete(viewerId)
      continue
    }

    if (entry.answer && !entry.leftAt && lastSeenAt > 0 && now - lastSeenAt > LIVE_STREAM_IDLE_VIEWER_TTL_MS) {
      entry.leftAt = nowIso()
      runtime.offersByViewerId.set(viewerId, entry)
      continue
    }

    if (entry.leftAt && leftAt > 0 && now - leftAt > LIVE_STREAM_IDLE_VIEWER_TTL_MS) {
      runtime.offersByViewerId.delete(viewerId)
    }
  }

  const endedAt = parseIsoTimestamp(runtime.endedAt)
  if (endedAt > 0 && now - endedAt > 5 * 60 * 1000 && runtime.offersByViewerId.size === 0) {
    liveRuntime.sessions.delete(sessionId)
  }
}

function countRuntimeViewers(runtime) {
  if (!runtime) return 0

  let total = 0
  for (const entry of runtime.offersByViewerId.values()) {
    if (entry.answer && !entry.leftAt) {
      total += 1
    }
  }

  return total
}

function getLiveViewerCount(sessionId) {
  pruneLiveRuntimeSession(sessionId)
  const runtime = liveRuntime.sessions.get(sessionId)
  return countRuntimeViewers(runtime)
}

function stopLiveSessionById(sessionId) {
  const key = safeString(sessionId)
  if (!key) return

  const closedAt = nowIso()
  stopLiveSessionStmt.run(closedAt, closedAt, key)

  const runtime = ensureLiveRuntimeSession(key)
  if (!runtime) return

  runtime.endedAt = closedAt
  for (const [viewerId, entry] of runtime.offersByViewerId.entries()) {
    if (!entry.leftAt) {
      entry.leftAt = closedAt
      entry.lastSeenAt = closedAt
      runtime.offersByViewerId.set(viewerId, entry)
    }
  }
}

function isLiveSessionExpired(row) {
  if (!row || row.status !== 'active') return false

  const startedAt = parseIsoTimestamp(row.started_at)
  if (!startedAt) return false

  return Date.now() - startedAt > LIVE_STREAM_MAX_DURATION_MS
}

function readLiveSessionById(sessionId) {
  const key = safeString(sessionId)
  if (!key) return null
  return selectLiveSessionByIdStmt.get(key) || null
}

function resolveLiveSessionById(sessionId) {
  const key = safeString(sessionId)
  if (!key) return null

  let row = readLiveSessionById(key)
  if (!row) return null

  if (isLiveSessionExpired(row)) {
    stopLiveSessionById(key)
    row = readLiveSessionById(key)
  }

  return row
}

function mapLiveSessionRow(row, viewerUserId = '') {
  return {
    id: row.id,
    ownerId: row.owner_user_id,
    ownerUsername: row.username || '',
    ownerDisplayName: row.display_name || row.username || 'Ciudadano VensuR',
    ownerAvatarUrl: row.avatar_url || '',
    title: row.title || 'Transmision en vivo',
    description: row.description || '',
    status: row.status || 'ended',
    startedAt: row.started_at || '',
    endedAt: row.ended_at || '',
    isOwner: viewerUserId === row.owner_user_id,
    canView: canViewerJoinLiveSession(viewerUserId, row.owner_user_id),
    viewerCount: getLiveViewerCount(row.id),
  }
}

function mapLiveRecordingRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_user_id,
    sessionId: row.session_id || '',
    title: row.title || 'Transmisión en vivo',
    mediaUrl: row.media_url || '',
    mediaType: row.media_type || 'video/webm',
    durationSec: Number(row.duration_sec ?? 0),
    visibility: normalizeProfileVisibility(row.visibility),
    views: Number(row.views ?? 0),
    createdAt: row.created_at || '',
    expiresAt: row.expires_at || '',
  }
}

function purgeExpiredLiveRecordings() {
  let removed = 0

  try {
    const expired = selectExpiredLiveRecordingsStmt.all(nowIso())

    for (const row of expired) {
      const fileName = safeString(row.media_url).replace(/^\/uploads\//, '')
      if (fileName && !fileName.includes('..') && !fileName.includes('/')) {
        try {
          unlinkSync(path.join(UPLOADS_DIR, fileName))
        } catch {
          // el archivo ya no existe: no pasa nada
        }
      }
      deleteLiveRecordingStmt.run(row.id)
      removed += 1
    }
  } catch (error) {
    console.error('[recordings] error al limpiar grabaciones vencidas:', error?.message || error)
  }

  return removed
}

function mapPublicProfilePayload(row, viewerUserId = '') {
  const mappedUser = mapDirectoryUserRow(row)
  const isSelf = Boolean(viewerUserId && viewerUserId === row.id)

  return {
    user: {
      ...mappedUser,
      followersCount: countFollowersForUser(row.id),
      followingCount: countFollowingForUser(row.id),
    },
    relationship: {
      isSelf,
      canFollow: Boolean(viewerUserId && !isSelf),
      isFollowing: isUserFollowing(viewerUserId, row.id),
    },
  }
}

function signSessionToken(userId) {
  return jwt.sign({ sub: userId }, AUTH_JWT_SECRET, { expiresIn: AUTH_JWT_EXPIRES_IN })
}

function verifySessionToken(token) {
  try {
    return jwt.verify(token, AUTH_JWT_SECRET)
  } catch {
    return null
  }
}

function makeUniqueUsername(seed) {
  const baseCandidate = normalizeUsername(seed) || `usuario_${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, '')}`
  const base = baseCandidate.slice(0, 24)

  if (base.length >= 3 && !selectUserByUsernameStmt.get(base)) {
    return base
  }

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const suffix = nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, '')
    const prefix = base.slice(0, Math.max(3, 24 - suffix.length - 1))
    const candidate = `${prefix}_${suffix}`.slice(0, 24)
    if (candidate.length >= 3 && !selectUserByUsernameStmt.get(candidate)) {
      return candidate
    }
  }

  return `usuario_${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 24)
}

const issueVerificationCodeTx = db.transaction((userId, codeHash) => {
  const now = nowIso()
  const expiresAt = addMinutesIso(EMAIL_VERIFICATION_CODE_TTL_MINUTES)

  invalidateActiveVerificationCodesStmt.run(now, userId)
  insertVerificationCodeStmt.run(
    nanoid(),
    userId,
    codeHash,
    now,
    expiresAt,
  )
})

async function issueVerificationCode(user) {
  const code = generateVerificationCode()
  issueVerificationCodeTx(user.id, hashVerificationCode(code))

  let sent = false

  try {
    const result = await sendVerificationEmail(
      { email: user.email, displayName: user.display_name },
      code,
    )
    sent = Boolean(result?.delivered)
  } catch (error) {
    // El fallo de envio no debe romper el registro: el usuario puede pedir reenvio.
    console.error(`[VERIFICACION] No se pudo enviar el correo a ${user.email}:`, error?.message || error)
  }

  // En local/development exponemos el codigo para poder probar sin proveedor SMTP real.
  if (EXPOSE_DEV_VERIFICATION_CODE) {
    console.log(`[VERIFICACION] ${user.email} -> ${code}`)
  }

  return {
    sent,
    debugVerificationCode: EXPOSE_DEV_VERIFICATION_CODE ? code : undefined,
  }
}

const upsertSocialUserTx = db.transaction((payload) => {
  const {
    provider,
    providerSub,
    email,
    emailVerified,
    displayName,
    avatarUrl,
  } = payload

  const now = nowIso()
  const normalizedEmail = normalizeEmail(email)
  const normalizedDisplayName = cleanDisplayName(displayName) || 'Ciudadano VensuR'
  const normalizedAvatar = safeString(avatarUrl)

  let user = selectUserBySocialSubStmt.get(provider, providerSub)

  if (user) {
    const nextDisplayName = user.display_name || normalizedDisplayName
    const nextEmailVerified = user.email_verified || (emailVerified ? 1 : 0)
    const nextAvatar = normalizedAvatar || user.avatar_url || ''

    updateUserSocialDetailsStmt.run(nextDisplayName, nextEmailVerified, nextAvatar, now, user.id)

    if (normalizedEmail) {
      updateSocialAccountStmt.run(normalizedEmail, now, provider, providerSub)
    }

    return selectUserByIdStmt.get(user.id)
  }

  if (!normalizedEmail) {
    throw new Error('No se encontro correo para asociar la cuenta social. Intenta primero con el mismo Apple ID.')
  }

  user = selectUserByEmailStmt.get(normalizedEmail)

  if (!user) {
    const userId = nanoid()
    const usernameSeed = normalizedEmail.split('@')[0] || provider
    const username = makeUniqueUsername(usernameSeed)
    const finalDisplayName = normalizedDisplayName || username

    insertUserStmt.run(
      userId,
      normalizedEmail,
      username,
      finalDisplayName,
      SOCIAL_PASSWORD_SENTINEL,
      '',
      '',
      emailVerified ? 1 : 0,
      normalizedAvatar,
      '',
      now,
      now,
    )

    user = selectUserByIdStmt.get(userId)
  }

  const socialAccount = selectSocialAccountStmt.get(provider, providerSub)

  if (!socialAccount) {
    insertSocialAccountStmt.run(
      nanoid(),
      user.id,
      provider,
      providerSub,
      normalizedEmail,
      now,
      now,
    )
  } else {
    updateSocialAccountStmt.run(normalizedEmail, now, provider, providerSub)
  }

  const nextDisplayName = user.display_name || normalizedDisplayName
  const nextEmailVerified = user.email_verified || (emailVerified ? 1 : 0)
  const nextAvatar = normalizedAvatar || user.avatar_url || ''

  updateUserSocialDetailsStmt.run(nextDisplayName, nextEmailVerified, nextAvatar, now, user.id)

  return selectUserByIdStmt.get(user.id)
})

async function verifyGoogleIdToken(idToken) {
  if (!googleClient || !GOOGLE_CLIENT_ID) {
    throw new Error('Google OAuth no esta configurado en el servidor.')
  }

  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  })

  const payload = ticket.getPayload()

  if (!payload?.sub) {
    throw new Error('No se pudo validar la identidad de Google.')
  }

  if (!payload.email) {
    throw new Error('Google no proporciono un correo para esta cuenta.')
  }

  const emailVerified = Boolean(payload.email_verified)
  if (!emailVerified) {
    throw new Error('Google no confirmo un correo verificado para esta cuenta.')
  }

  return {
    provider: 'google',
    providerSub: payload.sub,
    email: payload.email,
    emailVerified,
    displayName: payload.name || payload.given_name || '',
    avatarUrl: payload.picture || '',
  }
}

async function verifyAppleIdToken(idToken) {
  if (!APPLE_CLIENT_ID) {
    throw new Error('Apple OAuth no esta configurado en el servidor.')
  }

  const { payload } = await jwtVerify(idToken, appleJwks, {
    audience: APPLE_CLIENT_ID,
    issuer: 'https://appleid.apple.com',
  })

  const providerSub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!providerSub) {
    throw new Error('No se pudo validar la identidad de Apple.')
  }

  const email = typeof payload.email === 'string' ? payload.email : ''
  const emailVerified = payload.email_verified === true || payload.email_verified === 'true'

  if (!emailVerified) {
    throw new Error('Apple no confirmo un correo verificado para esta cuenta.')
  }

  return {
    provider: 'apple',
    providerSub,
    email,
    emailVerified,
  }
}

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
])

const ALLOWED_VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.avi',
  '.mkv',
])

const ALLOWED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
])

function getLowercaseFileExtension(fileName) {
  return path.extname(typeof fileName === 'string' ? fileName : '').toLowerCase()
}

function isImageUploadFile(file) {
  const mimeType = typeof file?.mimetype === 'string' ? file.mimetype.toLowerCase() : ''
  if (mimeType.startsWith('image/')) return true

  const extension = getLowercaseFileExtension(file?.originalname)
  return ALLOWED_IMAGE_EXTENSIONS.has(extension)
}

function isVideoUploadFile(file) {
  const mimeType = typeof file?.mimetype === 'string' ? file.mimetype.toLowerCase() : ''
  if (mimeType.startsWith('video/')) return true

  const extension = getLowercaseFileExtension(file?.originalname)
  return ALLOWED_VIDEO_EXTENSIONS.has(extension)
}

function isAudioUploadFile(file) {
  const mimeType = typeof file?.mimetype === 'string' ? file.mimetype.toLowerCase() : ''
  if (mimeType.startsWith('audio/')) return true

  const extension = getLowercaseFileExtension(file?.originalname)
  return ALLOWED_AUDIO_EXTENSIONS.has(extension)
}

const storage = multer.diskStorage({
  destination(request, file, callback) {
    void request
    void file
    callback(null, UPLOADS_DIR)
  },
  filename(request, file, callback) {
    void request

    const extension = path.extname(file.originalname || '').toLowerCase()
    const safeExtension = extension || (file.mimetype.startsWith('video/')
      ? '.mp4'
      : file.mimetype.startsWith('audio/')
        ? '.mp3'
        : '.jpg')

    callback(null, `${Date.now()}-${nanoid(8)}${safeExtension}`)
  },
})

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
  fileFilter(request, file, callback) {
    void request

    if (!isImageUploadFile(file) && !isVideoUploadFile(file) && !isAudioUploadFile(file)) {
      callback(new Error('Solo se permiten imagenes, videos o audios.'))
      return
    }

    callback(null, true)
  },
})

// Grabaciones de en vivo: pueden pesar más que un upload normal.
const uploadRecording = multer({
  storage,
  limits: {
    fileSize: LIVE_RECORDING_MAX_BYTES,
  },
  fileFilter(request, file, callback) {
    void request
    if (isVideoUploadFile(file) || (typeof file?.mimetype === 'string' && file.mimetype.startsWith('video/'))) {
      callback(null, true)
      return
    }
    callback(new Error('La grabación del en vivo debe ser un video.'))
  },
})

const app = express()

if (TRUST_PROXY) {
  // Permite valores como "1", "true" o una lista de IPs/subredes de proxies de confianza.
  app.set('trust proxy', TRUST_PROXY === 'true' ? 1 : TRUST_PROXY === 'false' ? false : TRUST_PROXY)
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
)

const corsOptions = ALLOWED_ORIGINS.length
  ? {
      origin(origin, callback) {
        // Peticiones sin Origin (curl, apps nativas, same-origin) se permiten.
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true)
          return
        }

        callback(new Error('Origen no permitido por CORS.'))
      },
      credentials: true,
    }
  : {}

app.use(cors(corsOptions))
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(UPLOADS_DIR))

/**
 * Limitador de peticiones en memoria (sin dependencias externas).
 * Suficiente para una sola instancia; en multi-instancia usar un store compartido.
 */
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map()

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of hits.entries()) {
      if (now > entry.resetAt) hits.delete(key)
    }
  }, Math.max(windowMs, 30_000))

  if (typeof sweep.unref === 'function') sweep.unref()

  return function rateLimiter(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown'
    const now = Date.now()
    const entry = hits.get(key)

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    entry.count += 1

    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSec))
      sendError(res, 429, message || 'Demasiadas solicitudes. Intenta mas tarde.')
      return
    }

    next()
  }
}

const authRateLimiter = createRateLimiter({
  windowMs: Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? '', 10) || 15 * 60 * 1000,
  max: Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '', 10) || 40,
  message: 'Demasiados intentos de autenticacion. Espera unos minutos e intenta de nuevo.',
})

function requireAuth(req, res, next) {
  const authorization = typeof req.headers.authorization === 'string' ? req.headers.authorization : ''

  if (!authorization.startsWith('Bearer ')) {
    sendError(res, 401, 'Debes iniciar sesion para continuar.')
    return
  }

  const token = authorization.slice('Bearer '.length).trim()
  const payload = verifySessionToken(token)
  const userId = typeof payload?.sub === 'string' ? payload.sub : ''

  if (!userId) {
    sendError(res, 401, 'Sesion invalida o expirada.')
    return
  }

  const user = selectUserByIdStmt.get(userId)
  if (!user) {
    sendError(res, 401, 'La sesion ya no es valida.')
    return
  }

  if (!user.email_verified) {
    sendError(res, 403, 'Debes verificar tu correo para continuar.', {
      errorCode: 'EMAIL_NOT_VERIFIED',
      email: user.email,
    })
    return
  }

  req.authUser = user
  next()
}

app.get('/api/health', (req, res) => {
  void req
  res.json({ ok: true, service: 'vensur-api' })
})

app.get('/api/rss', async (req, res) => {
  const rawUrl = typeof req.query?.url === 'string' ? req.query.url : ''
  const sourceUrl = normalizeRssUrl(rawUrl)

  if (!sourceUrl) {
    sendError(res, 400, 'Debes indicar una URL RSS valida.')
    return
  }

  if (!isAllowedRssUrl(sourceUrl)) {
    sendError(res, 403, 'La fuente RSS no esta permitida.')
    return
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, RSS_PROXY_TIMEOUT_MS)

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': 'VensuR-RSS-Proxy/1.0',
      },
    })

    if (!response.ok) {
      sendError(res, response.status, `No se pudo consultar la fuente RSS (${response.status}).`)
      return
    }

    const xmlText = await response.text()

    if (!xmlText.includes('<item') && !xmlText.includes('<entry')) {
      sendError(res, 422, 'La fuente RSS no trae items parseables.')
      return
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.send(xmlText)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      sendError(res, 504, 'Tiempo de espera agotado al consultar la fuente RSS.')
      return
    }

    const message = error instanceof Error ? error.message : 'No se pudo consultar la fuente RSS.'
    sendError(res, 502, message)
  } finally {
    clearTimeout(timeoutId)
  }
})

app.get('/api/auth/providers', (req, res) => {
  void req
  res.json({
    google: {
      enabled: Boolean(GOOGLE_CLIENT_ID),
      clientId: GOOGLE_CLIENT_ID,
    },
    apple: {
      enabled: Boolean(APPLE_CLIENT_ID),
      clientId: APPLE_CLIENT_ID,
    },
  })
})

app.post('/api/auth/register', authRateLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const username = normalizeUsername(req.body?.username)
  const displayName = cleanDisplayName(req.body?.displayName) || username
  const password = safeString(req.body?.password)

  if (!email || !username || !password) {
    sendError(res, 400, 'Completa correo, usuario y clave.')
    return
  }

  if (!isValidEmail(email)) {
    sendError(res, 400, 'El correo no tiene un formato valido.')
    return
  }

  if (!isValidUsername(username)) {
    sendError(res, 400, 'El usuario debe tener 3-24 caracteres: letras, numeros o _.')
    return
  }

  if (password.length < 8) {
    sendError(res, 400, 'La clave debe tener al menos 8 caracteres.')
    return
  }

  if (selectUserByEmailStmt.get(email)) {
    sendError(res, 409, 'Ese correo ya esta registrado.')
    return
  }

  if (selectUserByUsernameStmt.get(username)) {
    sendError(res, 409, 'Ese usuario ya existe.')
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const userId = nanoid()
  const now = nowIso()

  insertUserStmt.run(
    userId,
    email,
    username,
    displayName,
    passwordHash,
    '',
    '',
    0,
    '',
    '',
    now,
    now,
  )

  const user = selectUserByIdStmt.get(userId)
  const verification = await issueVerificationCode(user)

  res.status(201).json({
    requiresEmailVerification: true,
    email,
    verificationSent: verification.sent,
    debugVerificationCode: verification.debugVerificationCode,
    message: 'Te enviamos un codigo de verificacion. Debes verificar tu correo antes de iniciar sesion.',
  })
})

app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  const identifier = normalizeEmail(req.body?.identifier)
  const password = safeString(req.body?.password)

  if (!identifier || !password) {
    sendError(res, 400, 'Completa usuario/correo y clave.')
    return
  }

  const user = selectUserForLoginStmt.get(identifier, identifier)

  if (!user) {
    sendError(res, 401, 'Credenciales invalidas.')
    return
  }

  if (!isBcryptHash(user.password_hash)) {
    sendError(res, 401, 'Esta cuenta usa acceso social. Continua con Google o Apple.')
    return
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash)
  if (!isPasswordValid) {
    sendError(res, 401, 'Credenciales invalidas.')
    return
  }

  if (!user.email_verified) {
    const verification = await issueVerificationCode(user)

    sendError(res, 403, 'Debes verificar tu correo antes de iniciar sesion.', {
      errorCode: 'EMAIL_NOT_VERIFIED',
      email: user.email,
      verificationSent: verification.sent,
      debugVerificationCode: verification.debugVerificationCode,
    })
    return
  }

  const token = signSessionToken(user.id)

  res.json({
    token,
    user: mapUserRow(user),
  })
})

app.post('/api/auth/verify-email', authRateLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const code = normalizeVerificationCode(req.body?.code)

  if (!email || !code) {
    sendError(res, 400, 'Completa correo y codigo de verificacion.')
    return
  }

  if (!/^\d{6}$/.test(code)) {
    sendError(res, 400, 'El codigo debe tener 6 digitos.')
    return
  }

  const user = selectUserByEmailStmt.get(email)
  if (!user) {
    sendError(res, 404, 'No encontramos una cuenta con ese correo.')
    return
  }

  if (user.email_verified) {
    const token = signSessionToken(user.id)
    res.json({
      token,
      user: mapUserRow(user),
      verified: true,
    })
    return
  }

  const activeCode = selectLatestActiveVerificationCodeStmt.get(user.id)
  if (!activeCode || isExpired(activeCode.expires_at)) {
    sendError(res, 400, 'Tu codigo expiro. Solicita uno nuevo.', {
      errorCode: 'EMAIL_VERIFICATION_CODE_EXPIRED',
    })
    return
  }

  if (activeCode.attempts >= 8) {
    sendError(res, 429, 'Demasiados intentos fallidos. Solicita un nuevo codigo.', {
      errorCode: 'EMAIL_VERIFICATION_TOO_MANY_ATTEMPTS',
    })
    return
  }

  const matches = activeCode.code_hash === hashVerificationCode(code)
  if (!matches) {
    incrementVerificationCodeAttemptsStmt.run(activeCode.id)
    sendError(res, 400, 'Codigo incorrecto. Revisa e intenta de nuevo.', {
      errorCode: 'EMAIL_VERIFICATION_CODE_INVALID',
    })
    return
  }

  const consumedAt = nowIso()
  markVerificationCodeConsumedStmt.run(consumedAt, activeCode.id)
  markUserEmailVerifiedStmt.run(consumedAt, user.id)

  const verifiedUser = selectUserByIdStmt.get(user.id)
  const token = signSessionToken(verifiedUser.id)

  res.json({
    token,
    user: mapUserRow(verifiedUser),
    verified: true,
  })
})

app.post('/api/auth/resend-verification', authRateLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email)

  if (!email) {
    sendError(res, 400, 'Indica un correo para reenviar el codigo.')
    return
  }

  if (!isValidEmail(email)) {
    sendError(res, 400, 'El correo no tiene un formato valido.')
    return
  }

  const user = selectUserByEmailStmt.get(email)
  if (!user) {
    res.json({ ok: true, sent: false })
    return
  }

  if (user.email_verified) {
    res.json({ ok: true, sent: false, alreadyVerified: true })
    return
  }

  const verification = await issueVerificationCode(user)

  res.json({
    ok: true,
    sent: verification.sent,
    email,
    debugVerificationCode: verification.debugVerificationCode,
  })
})

app.post('/api/auth/oauth/google', authRateLimiter, async (req, res) => {
  const idToken = safeString(req.body?.idToken || req.body?.credential)
  if (!idToken) {
    sendError(res, 400, 'No recibimos el token de Google.')
    return
  }

  try {
    const profile = await verifyGoogleIdToken(idToken)
    const user = upsertSocialUserTx(profile)
    const token = signSessionToken(user.id)

    res.json({
      token,
      user: mapUserRow(user),
      provider: 'google',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar sesion con Google.'
    sendError(res, 401, message)
  }
})

app.post('/api/auth/oauth/apple', authRateLimiter, async (req, res) => {
  const idToken = safeString(req.body?.idToken)
  const firstName = safeString(req.body?.firstName)
  const lastName = safeString(req.body?.lastName)

  if (!idToken) {
    sendError(res, 400, 'No recibimos el token de Apple.')
    return
  }

  try {
    const verified = await verifyAppleIdToken(idToken)
    const displayName = cleanDisplayName(`${firstName} ${lastName}`)

    const user = upsertSocialUserTx({
      provider: verified.provider,
      providerSub: verified.providerSub,
      email: verified.email,
      emailVerified: verified.emailVerified,
      displayName,
      avatarUrl: '',
    })

    const token = signSessionToken(user.id)

    res.json({
      token,
      user: mapUserRow(user),
      provider: 'apple',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo iniciar sesion con Apple.'
    sendError(res, 401, message)
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: mapUserRow(req.authUser),
  })
})

app.patch('/api/auth/me', requireAuth, (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const displayName = cleanDisplayName(body.displayName) || req.authUser.display_name
  const nextBio = typeof body.bio === 'string' ? cleanBio(body.bio) : req.authUser.bio || ''
  const requestedEmail = typeof body.email === 'string' ? normalizeEmail(body.email) : req.authUser.email
  const requestedPhone = typeof body.phone === 'string' ? normalizePhone(body.phone) : (req.authUser.phone || '')
  const requestedUsername = normalizeUsername(body.username)
  const hasVisibilityUpdate = typeof body.profileVisibility === 'string'
  const nextVisibility = hasVisibilityUpdate
    ? normalizeProfileVisibility(body.profileVisibility)
    : normalizeProfileVisibility(req.authUser.profile_visibility)
  let nextUsername = req.authUser.username

  if (requestedUsername && requestedUsername !== req.authUser.username) {
    if (!isValidUsername(requestedUsername)) {
      sendError(res, 400, 'El usuario debe tener 3-24 caracteres: letras, numeros o _.')
      return
    }

    const existing = selectUserByUsernameStmt.get(requestedUsername)
    if (existing && existing.id !== req.authUser.id) {
      sendError(res, 409, 'Ese usuario ya existe.')
      return
    }

    nextUsername = requestedUsername
  }

  if (!requestedEmail || !isValidEmail(requestedEmail)) {
    sendError(res, 400, 'Debes ingresar un correo valido.')
    return
  }

  if (requestedEmail !== req.authUser.email) {
    const existingByEmail = selectUserByEmailStmt.get(requestedEmail)
    if (existingByEmail && existingByEmail.id !== req.authUser.id) {
      sendError(res, 409, 'Ese correo ya esta registrado.')
      return
    }
  }

  if (!isValidPhone(requestedPhone)) {
    sendError(res, 400, 'El numero de telefono no es valido.')
    return
  }

  const now = nowIso()

  updateUserProfileStmt.run(displayName, nextUsername, nextBio, requestedEmail, requestedPhone, now, req.authUser.id)
  if (hasVisibilityUpdate) {
    updateUserVisibilityStmt.run(nextVisibility, now, req.authUser.id)
  }

  const updatedUser = selectUserByIdStmt.get(req.authUser.id)
  res.json({
    user: mapUserRow(updatedUser),
  })
})

app.patch('/api/auth/me/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  if (!req.file) {
    sendError(res, 400, 'Debes adjuntar una imagen o video para el avatar.')
    return
  }

  const isImage = isImageUploadFile(req.file)
  const isVideo = isVideoUploadFile(req.file)

  if (!isImage && !isVideo) {
    if (typeof req.file.path === 'string' && req.file.path) {
      try {
        unlinkSync(req.file.path)
      } catch {
        // Ignoramos errores de limpieza para responder rapido al cliente.
      }
    }

    sendError(res, 400, 'El avatar debe ser una imagen o un video valido.')
    return
  }

  const avatarUrl = `/uploads/${req.file.filename}`
  const now = nowIso()

  updateUserAvatarStmt.run(avatarUrl, now, req.authUser.id)

  const updatedUser = selectUserByIdStmt.get(req.authUser.id)
  res.json({
    user: mapUserRow(updatedUser),
  })
})

app.patch('/api/auth/me/cover', requireAuth, upload.single('cover'), (req, res) => {
  if (!req.file) {
    sendError(res, 400, 'Debes adjuntar una imagen para la portada.')
    return
  }

  if (!isImageUploadFile(req.file)) {
    if (typeof req.file.path === 'string' && req.file.path) {
      try {
        unlinkSync(req.file.path)
      } catch {
        // Ignoramos errores de limpieza para responder rapido al cliente.
      }
    }

    sendError(res, 400, 'La portada debe ser una imagen valida.')
    return
  }

  const coverUrl = `/uploads/${req.file.filename}`
  const now = nowIso()

  updateUserCoverStmt.run(coverUrl, now, req.authUser.id)

  const updatedUser = selectUserByIdStmt.get(req.authUser.id)
  res.json({
    user: mapUserRow(updatedUser),
  })
})

app.get('/api/content/me/metrics', requireAuth, (req, res) => {
  const now = nowIso()
  const daysWindow = 7
  const fromIso = addDaysIso(-(daysWindow - 1))

  const postMetrics = selectUserPostMetricsStmt.get(req.authUser.id) || {}
  const storyMetrics = selectUserStoryMetricsStmt.get(nowIso(), req.authUser.id) || {}
  const sentComments = toNumeric(selectUserSentCommentsCountStmt.get(req.authUser.id)?.total)

  const postRows = selectUserPostsByDayStmt.all(req.authUser.id, fromIso)
  const commentRows = selectUserCommentsByDayStmt.all(req.authUser.id, fromIso)
  const postsByDay = new Map(postRows.map((row) => [row.day_key, toNumeric(row.total)]))
  const commentsByDay = new Map(commentRows.map((row) => [row.day_key, toNumeric(row.total)]))

  const activity = buildRecentDayKeys(daysWindow).map((dayKey) => ({
    day: dayKey,
    posts: postsByDay.get(dayKey) ?? 0,
    comments: commentsByDay.get(dayKey) ?? 0,
  }))

  const totalPosts = toNumeric(postMetrics.total_posts)
  const totalStories = toNumeric(storyMetrics.total_stories)
  const activeStories = toNumeric(storyMetrics.active_stories)
  const reactionsReceived = toNumeric(postMetrics.reactions_received) + toNumeric(storyMetrics.story_reactions_received)
  const commentsReceived = toNumeric(postMetrics.comments_received)
  const interactions = reactionsReceived + commentsReceived

  const createdAtMs = Date.parse(req.authUser.created_at)
  const profileAgeDays = Number.isFinite(createdAtMs)
    ? Math.max(1, Math.floor((Date.now() - createdAtMs) / (24 * 60 * 60 * 1000)))
    : 1

  res.json({
    totals: {
      posts: totalPosts,
      stories: totalStories,
      activeStories,
      reactionsReceived,
      commentsReceived,
      commentsSent: sentComments,
    },
    engagement: {
      interactions,
      avgReactionsPerPost: totalPosts ? Number((reactionsReceived / totalPosts).toFixed(2)) : 0,
      avgCommentsPerPost: totalPosts ? Number((commentsReceived / totalPosts).toFixed(2)) : 0,
      publicationsPerDay: Number((totalPosts / profileAgeDays).toFixed(2)),
    },
    activity,
    generatedAt: now,
  })
})

app.get('/api/content/me/friends', requireAuth, (req, res) => {
  const rows = listAcceptedFriendsByUserStmt.all(req.authUser.id, req.authUser.id, req.authUser.id)

  res.json({
    items: rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url || '',
    })),
  })
})

app.post('/api/content/me/friends/:username', requireAuth, (req, res) => {
  const friendUsername = normalizeUsername(req.params?.username)

  if (!friendUsername || !isValidUsername(friendUsername)) {
    sendError(res, 400, 'Usuario de amigo invalido.')
    return
  }

  const target = selectUserSummaryByUsernameStmt.get(friendUsername)
  if (!target) {
    sendError(res, 404, 'Usuario no encontrado para agregar como amigo.')
    return
  }

  if (target.id === req.authUser.id) {
    sendError(res, 400, 'No puedes agregarte como amigo.')
    return
  }

  const pairKey = buildFriendPairKey(req.authUser.id, target.id)
  if (!pairKey) {
    sendError(res, 400, 'No se pudo crear el vinculo de amistad.')
    return
  }

  if (!selectAcceptedFriendshipByPairStmt.get(pairKey)) {
    const now = nowIso()
    insertAcceptedFriendshipStmt.run(nanoid(), req.authUser.id, target.id, pairKey, now, now)
  }

  const friends = listAcceptedFriendsByUserStmt.all(req.authUser.id, req.authUser.id, req.authUser.id)
  res.status(201).json({
    ok: true,
    total: friends.length,
    friend: {
      id: target.id,
      username: target.username,
      displayName: target.display_name,
      avatarUrl: target.avatar_url || '',
    },
  })
})

app.delete('/api/content/me/friends/:username', requireAuth, (req, res) => {
  const friendUsername = normalizeUsername(req.params?.username)

  if (!friendUsername || !isValidUsername(friendUsername)) {
    sendError(res, 400, 'Usuario de amigo invalido.')
    return
  }

  const target = selectUserSummaryByUsernameStmt.get(friendUsername)
  if (!target) {
    sendError(res, 404, 'Usuario no encontrado.')
    return
  }

  const pairKey = buildFriendPairKey(req.authUser.id, target.id)
  if (!pairKey) {
    sendError(res, 400, 'No se pudo procesar la solicitud.')
    return
  }

  deleteFriendshipByPairStmt.run(pairKey)

  const friends = listAcceptedFriendsByUserStmt.all(req.authUser.id, req.authUser.id, req.authUser.id)
  res.json({
    ok: true,
    total: friends.length,
  })
})

app.get('/api/content/users/search', (req, res) => {
  const query = normalizeSearchQuery(req.query?.q)
  const requestedLimit = Number.parseInt(String(req.query?.limit ?? '24'), 10)
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(60, requestedLimit)) : 24

  const rows = query
    ? (() => {
        const escaped = escapeSqlLikePattern(query)
        const containsPattern = `%${escaped}%`
        const startsWithPattern = `${escaped}%`

        return searchUsersDirectoryStmt.all(
          containsPattern,
          containsPattern,
          containsPattern,
          query,
          query,
          startsWithPattern,
          limit,
        )
      })()
    : listUsersDirectoryStmt.all(limit)

  res.json({
    query,
    total: rows.length,
    items: rows.map(mapDirectoryUserRow),
  })
})

app.post('/api/content/users/:username/follow', requireAuth, (req, res) => {
  const targetUsername = normalizeUsername(req.params?.username)

  if (!targetUsername || !isValidUsername(targetUsername)) {
    sendError(res, 400, 'Usuario invalido para seguir.')
    return
  }

  const target = selectUserDirectoryProfileByUsernameStmt.get(targetUsername)
  if (!target) {
    sendError(res, 404, 'Usuario no encontrado.')
    return
  }

  if (target.id === req.authUser.id) {
    sendError(res, 400, 'No puedes seguirte a ti mismo.')
    return
  }

  const wasFollowing = isUserFollowing(req.authUser.id, target.id)
  if (!wasFollowing) {
    const now = nowIso()
    insertFollowRelationStmt.run(nanoid(), req.authUser.id, target.id, now, now)
  }

  res.status(wasFollowing ? 200 : 201).json({
    ok: true,
    relationship: {
      isSelf: false,
      canFollow: true,
      isFollowing: true,
    },
    counts: {
      followers: countFollowersForUser(target.id),
      following: countFollowingForUser(target.id),
    },
  })
})

app.delete('/api/content/users/:username/follow', requireAuth, (req, res) => {
  const targetUsername = normalizeUsername(req.params?.username)

  if (!targetUsername || !isValidUsername(targetUsername)) {
    sendError(res, 400, 'Usuario invalido para dejar de seguir.')
    return
  }

  const target = selectUserDirectoryProfileByUsernameStmt.get(targetUsername)
  if (!target) {
    sendError(res, 404, 'Usuario no encontrado.')
    return
  }

  if (target.id === req.authUser.id) {
    sendError(res, 400, 'No puedes dejar de seguirte a ti mismo.')
    return
  }

  deleteFollowRelationStmt.run(req.authUser.id, target.id)

  res.json({
    ok: true,
    relationship: {
      isSelf: false,
      canFollow: true,
      isFollowing: false,
    },
    counts: {
      followers: countFollowersForUser(target.id),
      following: countFollowingForUser(target.id),
    },
  })
})

app.get('/api/content/live/sessions/following', requireAuth, (req, res) => {
  const rows = listFollowingLiveSessionsStmt.all(req.authUser.id, req.authUser.id)
  const activeRows = rows.filter((row) => {
    if (isLiveSessionExpired(row)) {
      stopLiveSessionById(row.id)
      return false
    }

    return row.status === 'active'
  })

  res.json({
    total: activeRows.length,
    items: activeRows.map((row) => mapLiveSessionRow(row, req.authUser.id)),
  })
})

app.get('/api/content/live/sessions/:sessionId', requireAuth, (req, res) => {
  const sessionId = safeString(req.params?.sessionId)
  if (!sessionId) {
    sendError(res, 400, 'Sesion en vivo invalida.')
    return
  }

  const session = resolveLiveSessionById(sessionId)
  if (!session) {
    sendError(res, 404, 'La transmision no existe.')
    return
  }

  if (session.status !== 'active') {
    sendError(res, 410, 'La transmision ya finalizo.')
    return
  }

  if (!canViewerJoinLiveSession(req.authUser.id, session.owner_user_id)) {
    sendError(res, 403, 'Solo seguidores pueden ver esta transmision en vivo.')
    return
  }

  res.json({
    session: mapLiveSessionRow(session, req.authUser.id),
  })
})

app.post('/api/content/live/sessions', requireAuth, (req, res) => {
  const title = safeString(req.body?.title).slice(0, 120)
  const description = cleanBio(req.body?.description)

  if (!title) {
    sendError(res, 400, 'Agrega un titulo para iniciar el en vivo.')
    return
  }

  const currentActive = selectActiveLiveSessionByOwnerStmt.get(req.authUser.id)
  if (currentActive?.id) {
    stopLiveSessionById(currentActive.id)
  }

  const now = nowIso()
  const sessionId = nanoid()

  insertLiveStreamStmt.run(
    sessionId,
    req.authUser.id,
    title,
    description,
    now,
    now,
    now,
  )

  ensureLiveRuntimeSession(sessionId)
  const created = selectLiveSessionByIdStmt.get(sessionId)

  res.status(201).json({
    session: created ? mapLiveSessionRow(created, req.authUser.id) : null,
    sharePath: `/vivo?sesion=${encodeURIComponent(sessionId)}`,
  })
})

app.post('/api/content/live/sessions/:sessionId/stop', requireAuth, (req, res) => {
  const sessionId = safeString(req.params?.sessionId)
  if (!sessionId) {
    sendError(res, 400, 'Sesion en vivo invalida.')
    return
  }

  const session = readLiveSessionById(sessionId)
  if (!session) {
    sendError(res, 404, 'No se encontro la transmision en vivo.')
    return
  }

  if (session.owner_user_id !== req.authUser.id) {
    sendError(res, 403, 'Solo el creador puede detener esta transmision.')
    return
  }

  if (session.status === 'active') {
    stopLiveSessionById(sessionId)
  }

  const ended = readLiveSessionById(sessionId)
  res.json({
    ok: true,
    session: ended ? mapLiveSessionRow(ended, req.authUser.id) : null,
  })
})

app.post('/api/content/live/recordings', requireAuth, uploadRecording.single('media'), (req, res) => {
  if (!req.file) {
    sendError(res, 400, 'No se recibió la grabación del en vivo.')
    return
  }

  const cleanupFile = () => {
    if (typeof req.file?.path === 'string' && req.file.path) {
      try {
        unlinkSync(req.file.path)
      } catch {
        // no-op
      }
    }
  }

  const sessionId = safeString(req.body?.sessionId).slice(0, 40)
  const title = cleanDisplayName(req.body?.title) || 'Transmisión en vivo'
  const durationSec = Math.max(0, Math.min(4 * 60 * 60, Math.trunc(toNumeric(req.body?.durationSec))))

  // Si se indica un sessionId, debe ser una transmisión del propio usuario.
  if (sessionId) {
    const session = readLiveSessionById(sessionId)
    if (session && session.owner_user_id !== req.authUser.id) {
      cleanupFile()
      sendError(res, 403, 'No puedes guardar la grabación de otra transmisión.')
      return
    }
  }

  const visibility = normalizeProfileVisibility(req.authUser.profile_visibility)
  const now = nowIso()
  const expiresAt = new Date(Date.now() + LIVE_RECORDING_TTL_HOURS * 60 * 60 * 1000).toISOString()
  const recordingId = nanoid()
  const mediaUrl = `/uploads/${req.file.filename}`
  const mediaType = safeString(req.file.mimetype) || 'video/webm'

  insertLiveRecordingStmt.run(
    recordingId,
    req.authUser.id,
    sessionId,
    title,
    mediaUrl,
    mediaType,
    durationSec,
    visibility,
    now,
    expiresAt,
  )

  res.status(201).json({
    recording: mapLiveRecordingRow(selectLiveRecordingByIdStmt.get(recordingId)),
    ttlHours: LIVE_RECORDING_TTL_HOURS,
  })
})

app.get('/api/content/live/sessions/:sessionId/offers', requireAuth, (req, res) => {
  const sessionId = safeString(req.params?.sessionId)
  if (!sessionId) {
    sendError(res, 400, 'Sesion en vivo invalida.')
    return
  }

  const session = resolveLiveSessionById(sessionId)
  if (!session || session.status !== 'active') {
    sendError(res, 404, 'La transmision ya no esta activa.')
    return
  }

  if (session.owner_user_id !== req.authUser.id) {
    sendError(res, 403, 'Solo el creador puede recibir ofertas de espectadores.')
    return
  }

  pruneLiveRuntimeSession(sessionId)
  const runtime = ensureLiveRuntimeSession(sessionId)
  const now = Date.now()

  const items = Array.from(runtime?.offersByViewerId.values() ?? [])
    .filter((entry) => {
      if (entry.answer || entry.leftAt) return false

      const createdAt = parseIsoTimestamp(entry.createdAt)
      return createdAt > 0 && now - createdAt <= LIVE_STREAM_PENDING_OFFER_TTL_MS
    })
    .map((entry) => ({
      viewerId: entry.viewerId,
      viewer: {
        id: entry.viewerUserId,
        username: entry.viewerUsername,
        displayName: entry.viewerDisplayName,
        avatarUrl: entry.viewerAvatarUrl,
      },
      offer: entry.offer,
      createdAt: entry.createdAt,
    }))

  res.json({
    items,
    viewerCount: getLiveViewerCount(sessionId),
  })
})

app.post('/api/content/live/sessions/:sessionId/viewers/offer', requireAuth, (req, res) => {
  const sessionId = safeString(req.params?.sessionId)
  if (!sessionId) {
    sendError(res, 400, 'Sesion en vivo invalida.')
    return
  }

  const session = resolveLiveSessionById(sessionId)
  if (!session || session.status !== 'active') {
    sendError(res, 404, 'La transmision ya no esta activa.')
    return
  }

  if (!canViewerJoinLiveSession(req.authUser.id, session.owner_user_id)) {
    sendError(res, 403, 'Solo seguidores pueden unirse a esta transmision.')
    return
  }

  const offer = normalizeRtcSessionDescription(req.body?.offer, 'offer')
  if (!offer) {
    sendError(res, 400, 'Oferta WebRTC invalida para unirse al en vivo.')
    return
  }

  const runtime = ensureLiveRuntimeSession(sessionId)
  const now = nowIso()

  for (const [viewerId, entry] of runtime.offersByViewerId.entries()) {
    if (entry.viewerUserId === req.authUser.id && !entry.leftAt) {
      entry.leftAt = now
      entry.lastSeenAt = now
      runtime.offersByViewerId.set(viewerId, entry)
    }
  }

  const viewerId = nanoid()
  runtime.offersByViewerId.set(viewerId, {
    viewerId,
    viewerUserId: req.authUser.id,
    viewerUsername: req.authUser.username || '',
    viewerDisplayName: req.authUser.display_name || req.authUser.username || 'Ciudadano VensuR',
    viewerAvatarUrl: req.authUser.avatar_url || '',
    offer,
    answer: null,
    createdAt: now,
    answeredAt: '',
    leftAt: '',
    lastSeenAt: now,
  })

  res.status(201).json({
    viewerId,
    pollAfterMs: 1200,
  })
})

app.post('/api/content/live/sessions/:sessionId/viewers/:viewerId/answer', requireAuth, (req, res) => {
  const sessionId = safeString(req.params?.sessionId)
  const viewerId = safeString(req.params?.viewerId)

  if (!sessionId || !viewerId) {
    sendError(res, 400, 'Datos invalidos para responder al espectador.')
    return
  }

  const session = resolveLiveSessionById(sessionId)
  if (!session || session.status !== 'active') {
    sendError(res, 404, 'La transmision ya no esta activa.')
    return
  }

  if (session.owner_user_id !== req.authUser.id) {
    sendError(res, 403, 'Solo el creador puede responder ofertas de espectadores.')
    return
  }

  const answer = normalizeRtcSessionDescription(req.body?.answer, 'answer')
  if (!answer) {
    sendError(res, 400, 'Respuesta WebRTC invalida.')
    return
  }

  const runtime = ensureLiveRuntimeSession(sessionId)
  const entry = runtime.offersByViewerId.get(viewerId)
  if (!entry) {
    sendError(res, 404, 'No se encontro la solicitud del espectador.')
    return
  }

  if (entry.leftAt) {
    sendError(res, 410, 'El espectador ya abandono la transmision.')
    return
  }

  const now = nowIso()
  entry.answer = answer
  entry.answeredAt = now
  entry.lastSeenAt = now
  runtime.offersByViewerId.set(viewerId, entry)

  res.json({
    ok: true,
    viewerCount: getLiveViewerCount(sessionId),
  })
})

app.get('/api/content/live/sessions/:sessionId/viewers/:viewerId/answer', requireAuth, (req, res) => {
  const sessionId = safeString(req.params?.sessionId)
  const viewerId = safeString(req.params?.viewerId)

  if (!sessionId || !viewerId) {
    sendError(res, 400, 'Datos invalidos para consultar respuesta del en vivo.')
    return
  }

  const session = resolveLiveSessionById(sessionId)
  if (!session) {
    sendError(res, 404, 'La transmision no existe.')
    return
  }

  const runtime = ensureLiveRuntimeSession(sessionId)
  const entry = runtime.offersByViewerId.get(viewerId)

  if (!entry) {
    sendError(res, 404, 'No se encontro esa solicitud de visualizacion.')
    return
  }

  const isOwner = req.authUser.id === session.owner_user_id
  const isSameViewer = entry.viewerUserId === req.authUser.id

  if (!isOwner && !isSameViewer) {
    sendError(res, 403, 'No puedes consultar la respuesta de otro espectador.')
    return
  }

  if (entry.leftAt) {
    res.status(410).json({
      ready: false,
      ended: true,
      viewerCount: getLiveViewerCount(sessionId),
    })
    return
  }

  entry.lastSeenAt = nowIso()
  runtime.offersByViewerId.set(viewerId, entry)

  if (session.status !== 'active') {
    res.json({
      ready: false,
      ended: true,
      viewerCount: getLiveViewerCount(sessionId),
    })
    return
  }

  res.json({
    ready: Boolean(entry.answer),
    pending: !entry.answer,
    answer: entry.answer,
    viewerCount: getLiveViewerCount(sessionId),
  })
})

app.delete('/api/content/live/sessions/:sessionId/viewers/:viewerId', requireAuth, (req, res) => {
  const sessionId = safeString(req.params?.sessionId)
  const viewerId = safeString(req.params?.viewerId)

  if (!sessionId || !viewerId) {
    sendError(res, 400, 'Datos invalidos para salir del en vivo.')
    return
  }

  const session = readLiveSessionById(sessionId)
  if (!session) {
    sendError(res, 404, 'La transmision no existe.')
    return
  }

  const runtime = ensureLiveRuntimeSession(sessionId)
  const entry = runtime.offersByViewerId.get(viewerId)
  if (!entry) {
    res.json({ ok: true, viewerCount: getLiveViewerCount(sessionId) })
    return
  }

  const isOwner = req.authUser.id === session.owner_user_id
  const isSameViewer = entry.viewerUserId === req.authUser.id

  if (!isOwner && !isSameViewer) {
    sendError(res, 403, 'No puedes cerrar la sesion de otro espectador.')
    return
  }

  markLiveViewerLeft(sessionId, viewerId)

  res.json({
    ok: true,
    viewerCount: getLiveViewerCount(sessionId),
  })
})

app.get('/api/content/users/:username', (req, res) => {
  const targetUsername = normalizeUsername(req.params?.username)

  if (!targetUsername || !isValidUsername(targetUsername)) {
    sendError(res, 400, 'Usuario invalido.')
    return
  }

  const target = selectUserDirectoryProfileByUsernameStmt.get(targetUsername)
  if (!target) {
    sendError(res, 404, 'Usuario no encontrado.')
    return
  }

  const viewer = resolveOptionalAuthUser(req)
  res.json(mapPublicProfilePayload(target, viewer?.id || ''))
})

app.get('/api/content/posts', (req, res) => {
  const viewer = resolveOptionalAuthUser(req)
  const viewerUserId = viewer?.id || ''
  const likedPostIds = getLikedPostIdSet(viewerUserId)
  const rows = selectPostsStmt
    .all()
    .filter((row) => canViewerAccessUserContent(viewerUserId, row.user_id, row.profile_visibility))

  res.json({
    items: rows.map((row) => mapPostRow(row, { likedByViewer: likedPostIds.has(row.id) })),
  })
})

app.get('/api/content/posts/:postId/comments', (req, res) => {
  const postId = safeString(req.params?.postId)
  if (!postId) {
    sendError(res, 400, 'Debes indicar una publicacion valida.')
    return
  }

  const post = selectPostByIdStmt.get(postId)
  if (!post) {
    sendError(res, 404, 'Publicacion no encontrada.')
    return
  }

  const viewer = resolveOptionalAuthUser(req)
  const canAccess = canViewerAccessUserContent(viewer?.id || '', post.user_id, post.profile_visibility)
  if (!canAccess) {
    sendError(res, 403, 'Este perfil es privado. Solo amigos pueden ver este contenido.')
    return
  }

  const rows = selectPostCommentsStmt.all(postId)
  res.json({
    items: rows.map(mapPostCommentRow),
  })
})

app.post('/api/content/posts/:postId/comments', requireAuth, (req, res) => {
  const postId = safeString(req.params?.postId)
  const text = safeString(req.body?.text).slice(0, 260)

  if (!postId || !text) {
    sendError(res, 400, 'Escribe un comentario para publicar.')
    return
  }

  const post = selectPostByIdStmt.get(postId)
  if (!post) {
    sendError(res, 404, 'Publicacion no encontrada.')
    return
  }

  const canAccess = canViewerAccessUserContent(req.authUser.id, post.user_id, post.profile_visibility)
  if (!canAccess) {
    sendError(res, 403, 'Este perfil es privado. Solo amigos pueden comentar este contenido.')
    return
  }

  const comment = createPostComment({
    postId,
    userId: req.authUser.id,
    text,
  })

  if (!comment) {
    sendError(res, 400, 'No se pudo guardar el comentario.')
    return
  }

  const updatedPost = selectPostByIdStmt.get(postId)
  const likedByViewer = Boolean(selectPostReactionStmt.get(postId, req.authUser.id))
  res.status(201).json({
    comment,
    post: updatedPost ? mapPostRow(updatedPost, { likedByViewer }) : null,
  })
})

app.post('/api/content/me/posts', requireAuth, upload.single('media'), (req, res) => {
  const caption = safeString(req.body?.caption)
  const location = safeString(req.body?.location) || 'Venezuela'
  const alsoStory = toBooleanFlag(req.body?.alsoStory)
  const storyTitle = safeString(req.body?.storyTitle)
  const storyDescription = cleanBio(req.body?.storyDescription)

  if (!caption && !req.file) {
    sendError(res, 400, 'Escribe un texto o adjunta una imagen, video o audio para publicar.')
    return
  }

  const mediaUrl = req.file ? `/uploads/${req.file.filename}` : ''
  const mediaType = req.file?.mimetype ?? ''
  const now = nowIso()
  const postId = nanoid()

  insertPostStmt.run(
    postId,
    req.authUser.id,
    caption,
    mediaUrl,
    mediaType,
    location,
    0,
    0,
    now,
    now,
  )

  const post = selectPostByIdStmt.get(postId)
  const shouldCreateStory = Boolean(alsoStory && req.file)
  let story = null

  if (shouldCreateStory) {
    story = createStoryFromUploadedMedia({
      userId: req.authUser.id,
      title: storyTitle || buildStoryTitleFromCaption(caption || req.file?.originalname),
      description: storyDescription || cleanBio(caption),
      mediaUrl,
      mediaType,
    })
  }

  res.status(201).json({
    post: mapPostRow(post),
    story,
  })
})

app.patch('/api/content/posts/:postId/reaction', requireAuth, (req, res) => {
  const postId = safeString(req.params?.postId)
  const rawDelta = Number(req.body?.delta)
  // delta define la intencion (1 = like, -1 = quitar). Si no se envia, alterna.
  const intent = Number.isFinite(rawDelta) ? Math.max(-1, Math.min(1, Math.trunc(rawDelta))) : 0

  if (!postId) {
    sendError(res, 400, 'No se pudo actualizar la reaccion.')
    return
  }

  const post = selectPostByIdStmt.get(postId)
  if (!post) {
    sendError(res, 404, 'Publicacion no encontrada.')
    return
  }

  const canAccess = canViewerAccessUserContent(req.authUser.id, post.user_id, post.profile_visibility)
  if (!canAccess) {
    sendError(res, 403, 'Este perfil es privado. Solo amigos pueden reaccionar este contenido.')
    return
  }

  const result = togglePostReactionTx(postId, req.authUser.id, intent)
  const updatedPost = selectPostByIdStmt.get(postId)

  res.json({
    liked: result.liked,
    post: updatedPost ? mapPostRow(updatedPost, { likedByViewer: result.liked }) : null,
  })
})

app.patch('/api/content/stories/:storyId/reaction', requireAuth, (req, res) => {
  const storyId = safeString(req.params?.storyId)
  const rawDelta = Number(req.body?.delta)
  const intent = Number.isFinite(rawDelta) ? Math.max(-1, Math.min(1, Math.trunc(rawDelta))) : 0

  if (!storyId) {
    sendError(res, 400, 'No se pudo actualizar la reaccion de la historia.')
    return
  }

  const story = selectStoryByIdStmt.get(storyId)
  if (!story) {
    sendError(res, 404, 'Historia no encontrada.')
    return
  }

  const owner = selectUserByIdStmt.get(story.user_id)
  const visibility = owner?.profile_visibility || 'private'
  const canAccess = canViewerAccessUserContent(req.authUser.id, story.user_id, visibility)
  if (!canAccess) {
    sendError(res, 403, 'Este perfil es privado. Solo amigos pueden reaccionar esta historia.')
    return
  }

  const result = toggleStoryReactionTx(storyId, req.authUser.id, intent)
  const updatedStory = selectStoryByIdStmt.get(storyId)

  res.json({
    liked: result.liked,
    story: updatedStory ? mapStoryRow(updatedStory, { likedByViewer: result.liked }) : null,
  })
})

app.get('/api/content/stories', (req, res) => {
  const viewer = resolveOptionalAuthUser(req)
  const viewerUserId = viewer?.id || ''
  const likedStoryIds = getLikedStoryIdSet(viewerUserId)

  const rows = selectActiveStoriesStmt
    .all(nowIso())
    .filter((row) => canViewerAccessUserContent(viewerUserId, row.user_id, row.profile_visibility))
  res.json({
    items: rows.map((row) => mapStoryRow(row, { likedByViewer: likedStoryIds.has(row.id) })),
  })
})

app.get('/api/content/me/stories', requireAuth, (req, res) => {
  const rows = selectStoriesByOwnerStmt.all(req.authUser.id)
  const likedStoryIds = getLikedStoryIdSet(req.authUser.id)

  res.json({
    items: rows.map((row) => mapStoryRow(row, { likedByViewer: likedStoryIds.has(row.id) })),
  })
})

app.get('/api/content/me/posts', requireAuth, (req, res) => {
  const likedPostIds = getLikedPostIdSet(req.authUser.id)
  const rows = selectPostsByOwnerStmt.all(req.authUser.id)

  res.json({
    items: rows.map((row) => mapPostRow(row, { likedByViewer: likedPostIds.has(row.id) })),
  })
})

app.get('/api/content/me/recordings', requireAuth, (req, res) => {
  purgeExpiredLiveRecordings()
  const rows = selectLiveRecordingsByOwnerStmt.all(req.authUser.id, nowIso())

  res.json({
    ttlHours: LIVE_RECORDING_TTL_HOURS,
    items: rows.map(mapLiveRecordingRow),
  })
})

app.delete('/api/content/me/recordings/:recordingId', requireAuth, (req, res) => {
  const recordingId = safeString(req.params?.recordingId)
  const row = recordingId ? selectLiveRecordingByIdStmt.get(recordingId) : null

  if (!row || row.owner_user_id !== req.authUser.id) {
    sendError(res, 404, 'Grabación no encontrada.')
    return
  }

  const fileName = safeString(row.media_url).replace(/^\/uploads\//, '')
  if (fileName && !fileName.includes('..') && !fileName.includes('/')) {
    try {
      unlinkSync(path.join(UPLOADS_DIR, fileName))
    } catch {
      // ya no existe
    }
  }
  deleteLiveRecordingStmt.run(recordingId)

  res.json({ ok: true })
})

app.get('/api/content/users/:username/recordings', (req, res) => {
  const targetUsername = normalizeUsername(req.params?.username)
  if (!targetUsername || !isValidUsername(targetUsername)) {
    sendError(res, 400, 'Usuario invalido.')
    return
  }

  const target = selectUserDirectoryProfileByUsernameStmt.get(targetUsername)
  if (!target) {
    sendError(res, 404, 'Usuario no encontrado.')
    return
  }

  const viewer = resolveOptionalAuthUser(req)
  if (!canViewerAccessUserContent(viewer?.id || '', target.id, target.profile_visibility)) {
    res.json({ items: [] })
    return
  }

  purgeExpiredLiveRecordings()
  const rows = selectLiveRecordingsByOwnerStmt
    .all(target.id, nowIso())
    .filter((row) => normalizeProfileVisibility(row.visibility) === 'public' || viewer?.id === target.id)

  res.json({ items: rows.map(mapLiveRecordingRow) })
})

// Conteo de vistas (modo biblioteca). Fire-and-forget: el cliente marca cada
// id una sola vez por sesión, aquí solo incrementamos.
app.post('/api/content/posts/:postId/view', (req, res) => {
  const postId = safeString(req.params?.postId)
  if (postId) {
    try {
      incrementPostViewsStmt.run(postId)
    } catch {
      // publicación inexistente: ignoramos
    }
  }
  res.json({ ok: true })
})

app.post('/api/content/stories/:storyId/view', (req, res) => {
  const storyId = safeString(req.params?.storyId)
  if (storyId) {
    try {
      incrementStoryViewsStmt.run(storyId)
    } catch {
      // historia inexistente: ignoramos
    }
  }
  res.json({ ok: true })
})

app.post('/api/content/live/recordings/:recordingId/view', (req, res) => {
  const recordingId = safeString(req.params?.recordingId)
  if (recordingId) {
    try {
      incrementLiveRecordingViewsStmt.run(recordingId)
    } catch {
      // grabación inexistente: ignoramos
    }
  }
  res.json({ ok: true })
})

app.get('/api/content/music-library', (req, res) => {
  const query = normalizeSearchQuery(req.query?.q)
  const limitRaw = typeof req.query?.limit === 'string' ? req.query.limit : ''
  const parsedLimit = Number.parseInt(limitRaw, 10)
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(120, parsedLimit)) : 42
  const likePattern = `%${escapeSqlLikePattern(query)}%`

  const rows = query
    ? searchMusicTracksStmt.all(likePattern, likePattern, likePattern, likePattern, limit)
    : listMusicTracksStmt.all(limit)

  res.json({
    query,
    items: rows.map(mapMusicTrackRow),
  })
})

app.post('/api/content/me/stories', requireAuth, upload.single('media'), (req, res) => {
  const title = safeString(req.body?.title)
  const description = cleanBio(req.body?.description)
  const rawMetadata = req.body?.metadata
  let parsedMetadataInput = rawMetadata

  if (typeof rawMetadata === 'string') {
    const metadataText = rawMetadata.trim()

    if (metadataText) {
      try {
        parsedMetadataInput = JSON.parse(metadataText)
      } catch {
        sendError(res, 400, 'La metadata de la historia no es valida.')
        return
      }
    }
  }

  const metadata = parseStoryMetadataInput(parsedMetadataInput)

  if (!title) {
    sendError(res, 400, 'Agrega un titulo para la historia.')
    return
  }

  const story = createStoryFromUploadedMedia({
    userId: req.authUser.id,
    title,
    description,
    mediaUrl: req.file ? `/uploads/${req.file.filename}` : '',
    mediaType: req.file?.mimetype ?? '',
    metadata,
  })

  if (!story) {
    sendError(res, 400, 'No se pudo crear la historia en este momento.')
    return
  }

  res.status(201).json({
    story,
  })
})

app.get('/api/content/bots/status', (req, res) => {
  void req

  const postsCount = db.prepare('SELECT COUNT(*) AS total FROM posts').get()?.total ?? 0
  const activeStoriesCount = db.prepare('SELECT COUNT(*) AS total FROM stories WHERE expires_at > ?').get(nowIso())?.total ?? 0
  const memoryBuckets = botRuntime.commentTemplateMemoryByUser.size
  const memoryEntries = Array.from(botRuntime.commentTemplateMemoryByUser.values())
    .reduce((total, current) => total + (Array.isArray(current) ? current.length : 0), 0)

  res.json({
    enabled: BOTS_ENABLED,
    configuredUsers: BOT_USER_COUNT,
    behavior: normalizeBotBehavior(botRuntime.behavior),
    users: botRuntime.users.map((entry) => ({
      email: entry.profile.email,
      username: entry.user?.username,
      displayName: entry.user?.display_name,
    })),
    tickIntervalMs: Math.max(15_000, BOTS_TICK_INTERVAL_MS),
    ticks: botRuntime.ticks,
    lastTickAt: botRuntime.lastTickAt,
    mediaPool: {
      images: botRuntime.mediaPool.images.length,
      videos: botRuntime.mediaPool.videos.length,
      total: botRuntime.mediaPool.total,
      refreshedAt: botRuntime.mediaPool.refreshedAt,
    },
    commentMemory: {
      buckets: memoryBuckets,
      entries: memoryEntries,
      maxPerBot: BOT_COMMENT_MEMORY_SIZE,
      recentBlock: BOT_COMMENT_RECENT_BLOCK,
    },
    totals: {
      posts: Number(postsCount),
      activeStories: Number(activeStoriesCount),
    },
  })
})

app.post('/api/content/bots/media/reimport', requireBotControl, async (req, res) => {
  if (!BOTS_ENABLED) {
    sendError(res, 400, 'Los bots estan desactivados en esta instancia.')
    return
  }

  const copied = syncPublicMediaToUploads()
  await refreshBotMediaPool()

  res.json({
    ok: true,
    copied,
    mediaPool: {
      images: botRuntime.mediaPool.images.length,
      videos: botRuntime.mediaPool.videos.length,
      total: botRuntime.mediaPool.total,
      refreshedAt: botRuntime.mediaPool.refreshedAt,
    },
  })
})

app.patch('/api/content/bots/behavior', requireBotControl, (req, res) => {
  if (!BOTS_ENABLED) {
    sendError(res, 400, 'Los bots estan desactivados en esta instancia.')
    return
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const nextBehavior = normalizeBotBehavior({
    ...botRuntime.behavior,
    ...body,
  })

  botRuntime.behavior = nextBehavior

  res.json({
    ok: true,
    behavior: nextBehavior,
  })
})

app.post('/api/content/bots/tick', requireBotControl, (req, res) => {
  if (!BOTS_ENABLED) {
    sendError(res, 400, 'Los bots estan desactivados en esta instancia.')
    return
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const forceCreate = body.forceCreate == null ? true : toBooleanFlag(body.forceCreate)
  const bursts = Number.parseInt(body.bursts ?? '1', 10)
  const safeBursts = Number.isFinite(bursts) ? Math.max(1, Math.min(20, bursts)) : 1

  const summaries = []
  for (let index = 0; index < safeBursts; index += 1) {
    summaries.push(runBotsTick({ forceCreate }))
  }

  const summary = summaries[summaries.length - 1] ?? null
  res.json({ ok: true, summary })
})

app.use((error, req, res, next) => {
  void req
  void next

  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    sendError(res, 400, 'El archivo excede el tamano maximo de 20MB.')
    return
  }

  if (error instanceof Error) {
    sendError(res, 400, error.message || 'No se pudo completar la solicitud.')
    return
  }

  sendError(res, 500, 'Error interno del servidor.')
})

const recordingCleanupTimer = setInterval(() => {
  const removed = purgeExpiredLiveRecordings()
  if (removed > 0) console.log(`[recordings] ${removed} grabación(es) vencida(s) eliminadas`)
}, LIVE_RECORDING_CLEANUP_INTERVAL_MS)
if (typeof recordingCleanupTimer.unref === 'function') recordingCleanupTimer.unref()

app.listen(API_PORT, () => {
  console.log(`VensuR API activa en http://127.0.0.1:${API_PORT}`)
  purgeExpiredLiveRecordings()
  void startBotsAutomation()
})

const STORAGE_KEY = 'vensur.noticias'
const EXCLUSIONS_KEY = 'vensur.noticias.exclusions'
const MOCK_ENDPOINT = '/mock/noticias.json'
const NETWORK_DELAY_MS = 40
const FEED_TIMEOUT_MS = 4500
const MAX_STORED_NEWS = 220
const MAX_EXCLUSIONS_PER_SOURCE = 40

const FUENTES = [
  { nombre: 'El Nacional', url: 'https://www.elnacional.com/feed/' },
  { nombre: 'Efecto Cocuyo', url: 'https://efectococuyo.com/feed/' },
  { nombre: 'Tal Cual', url: 'https://talcualdigital.com/feed/' },
  { nombre: 'Runrun.es', url: 'https://runrun.es/feed/' },
  { nombre: 'Armando.info', url: 'https://armando.info/feed/' },
  { nombre: 'Transparencia Venezuela', url: 'https://transparencia.org.ve/feed/' },
  { nombre: 'PROVEA', url: 'https://provea.org/feed/' },
  { nombre: 'Foro Penal', url: 'https://foropenal.com/feed/' },
]

const SOURCE_NAMES = FUENTES.map((source) => source.nombre)

const PALABRAS_CLAVE = [
  'venezuela',
  'caracas',
  'maduro',
  'pdvsa',
  'chavismo',
  'miranda',
  'zulia',
  'tachira',
  'barinas',
  'guaido',
  'la guaira',
  'merida',
  'anzoategui',
  'electrico',
  'racionamiento',
  'agua',
  'lluvias',
  'sismo',
  'hospital',
]

const PALABRAS_PAIS = [
  'venezuela',
  'caracas',
  'miranda',
  'zulia',
  'tachira',
  'barinas',
]

const CATEGORIAS_INTERES = {
  conflicto_politico: [
    'oposicion',
    'represion',
    'protesta',
    'detenido',
    'detencion arbitraria',
    'preso politico',
    'presos politicos',
    'exilio',
    'persecucion politica',
  ],
  colectivos_violencia: [
    'colectivo',
    'colectivos',
    'paramilitar',
    'asesinato',
    'ejecucion extrajudicial',
    'masacre',
    'desaparicion forzada',
    'fosas',
    'violencia armada',
  ],
  corrupcion: [
    'corrupcion',
    'peculado',
    'malversacion',
    'lavado de dinero',
    'soborno',
    'contrabando',
    'sobreprecio',
    'caso pdvsa',
    'narcotrafico',
  ],
  funcionarios_gobierno: [
    'nicolas maduro',
    'diosdado cabello',
    'delcy rodriguez',
    'cilia flores',
    'tareck el aissami',
    'vladimir padrino lopez',
    'tsj',
    'cne',
    'fiscalia general',
  ],
}

const PALABRAS_RUIDO = [
  'premier league',
  'champions',
  'fifa',
  'farandula',
  'celebridad',
  'hollywood',
]

const TRACKING_QUERY_PARAMS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'source',
  'spm',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
])

const FEED_ENDPOINTS = [
  {
    name: 'proxy_local',
    build: (url) => `/api/rss?url=${encodeURIComponent(url)}`,
  },
  {
    name: 'allorigins',
    build: (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  },
  {
    name: 'isomorphic',
    build: (url) => `https://cors.isomorphic-git.org/${url}`,
  },
]

const HTML_ENTITIES = {
  '&amp;': '&',
  '&#038;': '&',
  '&nbsp;': ' ',
  '&quot;': '"',
  '&#34;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
}

/** @typedef {{
 * id: string,
 * urlHash: string,
 * title: string,
 * summary: string,
 * url: string,
 * source: string,
 * publishedAt: string,
 * categories: string[],
 * mediaUrl: string
 * }} NewsItem */

/** @typedef {{
 * source: string,
 * status: 'ok' | 'error',
 * count: number,
 * strategy?: string,
 * error?: string
 * }} NewsReport */

/** @typedef {Record<string, string[]>} NewsSourceExclusions */

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function hasStorage() {
  return typeof window !== 'undefined' && window.localStorage
}

function decodeHtmlEntities(text) {
  let output = text

  for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
    output = output.split(entity).join(replacement)
  }

  output = output.replace(/&#(\d+);/g, (_match, code) => {
    const value = Number(code)
    return Number.isNaN(value) ? '' : String.fromCharCode(value)
  })

  output = output.replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
    const value = parseInt(code, 16)
    return Number.isNaN(value) ? '' : String.fromCharCode(value)
  })

  return output
}

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function removeFeedBoilerplate(text) {
  return text
    .replace(/the post[\s\S]*?appeared first on[\s\S]*$/i, '')
    .replace(/read more[\s\S]*$/i, '')
    .trim()
}

function normalizeText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function normalizeKeyword(keyword) {
  return normalizeText(keyword).replace(/\s+/g, ' ').trim()
}

function toShortSummary(text) {
  const decoded = decodeHtmlEntities(text)
  const cleaned = removeFeedBoilerplate(stripHtml(decoded))
  return cleaned.slice(0, 280)
}

function includesKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword))
}

function classifyCategories(titulo, resumen) {
  const normalized = normalizeText(`${titulo} ${resumen}`)
  const categories = []

  for (const [category, keywords] of Object.entries(CATEGORIAS_INTERES)) {
    if (includesKeyword(normalized, keywords)) {
      categories.push(category)
    }
  }

  return categories
}

function normalizeMediaUrl(rawUrl) {
  const value = safeMediaCandidate(rawUrl)
  if (!value) return ''

  if (value.startsWith('//')) {
    return `https:${value}`
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  return ''
}

function safeMediaCandidate(rawValue) {
  return typeof rawValue === 'string' ? rawValue.trim() : ''
}

function extractFirstImageFromHtml(htmlText) {
  const raw = typeof htmlText === 'string' ? htmlText : ''
  if (!raw) return ''

  const directMatch = raw.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (directMatch?.[1]) {
    return normalizeMediaUrl(directMatch[1])
  }

  return ''
}

function extractFeedImage(item, rawSummary) {
  const mediaTagNames = new Set(['enclosure', 'content', 'thumbnail'])
  const mediaNodes = Array.from(item.getElementsByTagName('*'))

  for (const node of mediaNodes) {
    const localName = (node.localName ?? '').toLowerCase()
    if (!mediaTagNames.has(localName)) continue

    const nodeName = (node.nodeName ?? '').toLowerCase()
    const isNamespacedMedia = nodeName.startsWith('media:')
    const isEnclosure = localName === 'enclosure'

    if (!isNamespacedMedia && !isEnclosure) continue

    const candidate = normalizeMediaUrl(node.getAttribute('url'))
    if (candidate) return candidate
  }

  const summaryImage = extractFirstImageFromHtml(rawSummary)
  if (summaryImage) return summaryImage

  const encoded = textFromNode(item, ['content\\:encoded', 'description', 'summary', 'content'])
  return extractFirstImageFromHtml(encoded)
}

function esSobreVenezuela(titulo, resumen, categories = []) {
  const normalized = normalizeText(`${titulo} ${resumen}`)
  const hasSignal = includesKeyword(normalized, PALABRAS_CLAVE)
  const hasCountryMention = includesKeyword(normalized, PALABRAS_PAIS)
  const hasCategory = categories.length > 0

  if (!hasSignal && !hasCountryMention && !hasCategory) return false

  const hasNoise = includesKeyword(normalized, PALABRAS_RUIDO)
  if (!hasNoise) return true

  return hasCountryMention || hasCategory
}

function normalizeNewsUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl.trim())
    parsed.hash = ''

    const entries = []
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase()
      if (normalizedKey.startsWith('utm_')) continue
      if (TRACKING_QUERY_PARAMS.has(normalizedKey)) continue
      entries.push([key, value])
    }

    entries.sort((first, second) => {
      if (first[0] === second[0]) return first[1].localeCompare(second[1])
      return first[0].localeCompare(second[0])
    })

    parsed.search = ''
    for (const [key, value] of entries) {
      parsed.searchParams.append(key, value)
    }

    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    parsed.hostname = parsed.hostname.toLowerCase()

    return parsed.toString()
  } catch {
    return rawUrl.trim()
  }
}

function hashDeUrl(url) {
  const cleaned = normalizeNewsUrl(url).toLowerCase()
  let hash = 0

  for (let index = 0; index < cleaned.length; index += 1) {
    hash = (hash << 5) - hash + cleaned.charCodeAt(index)
    hash |= 0
  }

  return `url_${Math.abs(hash).toString(16)}`
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString()

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()

  return parsed.toISOString()
}

function textFromNode(parent, selectors) {
  for (const selector of selectors) {
    const node = parent.querySelector(selector)
    if (!node) continue

    const fromText = node.textContent?.trim()
    if (fromText) return fromText

    const fromValue = node.getAttribute('value')?.trim()
    if (fromValue) return fromValue
  }

  return ''
}

function linkFromNode(node) {
  const links = Array.from(node.querySelectorAll('link'))

  for (const linkNode of links) {
    const rel = (linkNode.getAttribute('rel') ?? '').toLowerCase()
    const href = linkNode.getAttribute('href')?.trim()

    if (href && rel !== 'self') return href

    const textLink = linkNode.textContent?.trim()
    if (textLink?.startsWith('http')) return textLink
  }

  const guid = textFromNode(node, ['guid', 'id'])
  if (guid.startsWith('http')) return guid

  return ''
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  return 'Error desconocido'
}

function parseKeywordInput(rawText) {
  const keywords = rawText
    .split(/[\n,;]+/)
    .map((item) => normalizeKeyword(item))
    .filter(Boolean)

  return Array.from(new Set(keywords)).slice(0, MAX_EXCLUSIONS_PER_SOURCE)
}

function isKnownSource(source) {
  return SOURCE_NAMES.includes(source)
}

/** @returns {NewsSourceExclusions} */
function emptyExclusionsRecord() {
  /** @type {NewsSourceExclusions} */
  const record = {}

  for (const sourceName of SOURCE_NAMES) {
    record[sourceName] = []
  }

  return record
}

/** @returns {NewsSourceExclusions | null} */
function readStorageExclusions() {
  if (!hasStorage()) return null

  const raw = window.localStorage.getItem(EXCLUSIONS_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** @param {NewsSourceExclusions} record */
function writeStorageExclusions(record) {
  if (!hasStorage()) return
  window.localStorage.setItem(EXCLUSIONS_KEY, JSON.stringify(record))
}

/**
 * @param {NewsSourceExclusions | null} raw
 * @returns {NewsSourceExclusions}
 */
function sanitizeExclusionsRecord(raw) {
  const output = emptyExclusionsRecord()
  if (!raw || typeof raw !== 'object') return output

  for (const sourceName of SOURCE_NAMES) {
    const value = raw[sourceName]
    if (!Array.isArray(value)) continue

    const cleaned = value.map((item) => normalizeKeyword(String(item))).filter(Boolean)
    output[sourceName] = Array.from(new Set(cleaned)).slice(0, MAX_EXCLUSIONS_PER_SOURCE)
  }

  return output
}

/** @returns {NewsSourceExclusions} */
export function getSourceExclusions() {
  return sanitizeExclusionsRecord(readStorageExclusions())
}

/**
 * @param {string} source
 * @param {string} rawKeywords
 * @returns {string[]}
 */
export function saveSourceExclusions(source, rawKeywords) {
  if (!isKnownSource(source)) {
    throw new Error('Fuente no permitida')
  }

  const exclusions = getSourceExclusions()
  exclusions[source] = parseKeywordInput(rawKeywords)
  writeStorageExclusions(exclusions)

  return exclusions[source]
}

export function getNewsSources() {
  return [...SOURCE_NAMES]
}

function shouldIncludeNews(title, summary, categories = []) {
  return esSobreVenezuela(title, summary, categories)
}

/**
 * @param {string} sourceName
 * @param {string} title
 * @param {string} summary
 * @param {NewsSourceExclusions} exclusionsBySource
 */
function shouldExcludeBySource(sourceName, title, summary, exclusionsBySource) {
  const keywords = exclusionsBySource[sourceName] ?? []
  if (!keywords.length) return false

  const normalized = normalizeText(`${title} ${summary}`)
  return includesKeyword(normalized, keywords)
}

/**
 * @param {Partial<NewsItem>} item
 * @returns {NewsItem | null}
 */
function normalizeNewsItem(item) {
  const title = toShortSummary(item.title ?? '').slice(0, 180)
  const summary = toShortSummary(item.summary || title)
  const url = normalizeNewsUrl(item.url ?? '')
  const categories = Array.isArray(item.categories)
    ? Array.from(new Set(item.categories.map((value) => String(value).trim()).filter(Boolean))).slice(0, 6)
    : []
  const mediaUrl = normalizeMediaUrl(item.mediaUrl ?? '')

  if (!title || !url) return null

  const urlHash = hashDeUrl(url)

  return {
    id: urlHash,
    urlHash,
    title,
    summary,
    url,
    source: (item.source ?? 'Fuente').trim() || 'Fuente',
    publishedAt: toIsoDate(item.publishedAt),
    categories,
    mediaUrl,
  }
}

/**
 * @param {string} xmlText
 * @param {string} sourceName
 * @param {NewsSourceExclusions} exclusionsBySource
 * @returns {NewsItem[]}
 */
function parseFeedItems(xmlText, sourceName, exclusionsBySource) {
  const document = new DOMParser().parseFromString(xmlText, 'text/xml')
  const parserError = document.querySelector('parsererror')
  if (parserError) {
    throw new Error(`XML invalido para ${sourceName}`)
  }

  const rssItems = Array.from(document.querySelectorAll('item'))
  const atomEntries = Array.from(document.querySelectorAll('entry'))
  const items = rssItems.length ? rssItems : atomEntries

  return items
    .map((item) => {
      const titleRaw = textFromNode(item, ['title'])
      const title = toShortSummary(titleRaw).slice(0, 180)
      const rawSummary = textFromNode(item, [
        'content\\:encoded',
        'description',
        'summary',
        'content',
      ])
      const summary = toShortSummary(rawSummary || title)
      const url = normalizeNewsUrl(linkFromNode(item))
      const publishedAt = toIsoDate(textFromNode(item, ['pubDate', 'updated', 'published']))
      const categories = classifyCategories(title, summary)
      const mediaUrl = extractFeedImage(item, rawSummary)

      if (!title || !url) return null
      if (!shouldIncludeNews(title, summary, categories)) return null
      if (shouldExcludeBySource(sourceName, title, summary, exclusionsBySource)) return null

      return normalizeNewsItem({
        title,
        summary,
        url,
        source: sourceName,
        publishedAt,
        categories,
        mediaUrl,
      })
    })
    .filter(Boolean)
}

/** @param {NewsItem[]} items */
function sortByPublished(items) {
  return [...items].sort((first, second) => {
    return new Date(second.publishedAt).getTime() - new Date(first.publishedAt).getTime()
  })
}

/** @param {NewsItem[]} items */
function dedupeByHash(items) {
  const map = new Map()

  for (const item of items) {
    map.set(item.urlHash, item)
  }

  return Array.from(map.values())
}

/**
 * @param {NewsItem[]} items
 * @param {NewsSourceExclusions} exclusionsBySource
 */
function keepRelevant(items, exclusionsBySource) {
  return items.filter((item) => {
    const categories = Array.isArray(item.categories) ? item.categories : []

    return (
      shouldIncludeNews(item.title, item.summary, categories) &&
      !shouldExcludeBySource(item.source, item.title, item.summary, exclusionsBySource)
    )
  })
}

/** @param {NewsItem[]} items */
function limitNews(items) {
  return items.slice(0, MAX_STORED_NEWS)
}

/**
 * @param {string} url
 * @returns {Promise<{ xmlText: string, strategy: string }>}
 */
async function fetchFeedXml(url) {
  let lastError = null

  for (const endpoint of FEED_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint.build(url))
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const xmlText = await response.text()
      if (!xmlText.includes('<item') && !xmlText.includes('<entry')) {
        throw new Error('Sin items parseables')
      }

      return { xmlText, strategy: endpoint.name }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('No se pudo descargar el feed RSS')
}

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, FEED_TIMEOUT_MS)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/** @returns {NewsItem[] | null} */
function readStorageNoticias() {
  if (!hasStorage()) return null

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** @param {NewsItem[]} noticias */
function writeStorageNoticias(noticias) {
  if (!hasStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(noticias))
}

/** @returns {Promise<NewsItem[]>} */
async function loadSeedNoticias() {
  try {
    const response = await fetch(MOCK_ENDPOINT)
    if (!response.ok) throw new Error('No se pudo cargar el archivo de mock')

    /** @type {NewsItem[]} */
    const noticias = await response.json()
    return sortByPublished(noticias)
  } catch {
    return []
  }
}

/** @returns {Promise<NewsItem[]>} */
async function ensureNoticias() {
  const exclusionsBySource = getSourceExclusions()
  const stored = readStorageNoticias()

  if (stored?.length) {
    const normalizedStored = stored.map(normalizeNewsItem).filter(Boolean)
    const relevantStored = limitNews(
      sortByPublished(dedupeByHash(keepRelevant(normalizedStored, exclusionsBySource))),
    )
    writeStorageNoticias(relevantStored)
    return relevantStored
  }

  const seeded = await loadSeedNoticias()
  const normalizedSeeded = seeded.map(normalizeNewsItem).filter(Boolean)
  const relevantSeeded = limitNews(
    sortByPublished(dedupeByHash(keepRelevant(normalizedSeeded, exclusionsBySource))),
  )

  if (relevantSeeded.length) {
    writeStorageNoticias(relevantSeeded)
  }

  return relevantSeeded
}

/** @returns {Promise<NewsItem[]>} */
export async function getNoticias() {
  await wait(NETWORK_DELAY_MS)
  return ensureNoticias()
}

/**
 * @param {{ nombre: string, url: string }} source
 * @param {NewsSourceExclusions} exclusionsBySource
 */
async function collectFromSource(source, exclusionsBySource) {
  try {
    const { xmlText, strategy } = await fetchFeedXml(source.url)
    const items = parseFeedItems(xmlText, source.nombre, exclusionsBySource)

    return {
      source: source.nombre,
      status: 'ok',
      count: items.length,
      strategy,
      items,
    }
  } catch (error) {
    return {
      source: source.nombre,
      status: 'error',
      count: 0,
      strategy: 'none',
      error: toErrorMessage(error),
      items: [],
    }
  }
}

/** @returns {Promise<{ items: NewsItem[], report: NewsReport[] }>} */
export async function recolectarNoticias() {
  const exclusionsBySource = getSourceExclusions()
  const sourceResults = await Promise.all(
    FUENTES.map((source) => collectFromSource(source, exclusionsBySource)),
  )
  const allItems = sourceResults.flatMap((result) => result.items)
  const deduped = limitNews(sortByPublished(dedupeByHash(allItems)))

  const report = sourceResults.map(({ source, status, count, strategy, error }) => ({
    source,
    status,
    count,
    strategy,
    error,
  }))

  return {
    items: deduped,
    report,
  }
}

/** @returns {Promise<{ items: NewsItem[], added: number, fallback: boolean, report: NewsReport[] }>} */
export async function actualizarNoticias() {
  await wait(40)

  const current = await ensureNoticias()
  const { items: fetchedItems, report } = await recolectarNoticias()

  if (!fetchedItems.length) {
    return {
      items: current,
      added: 0,
      fallback: true,
      report,
    }
  }

  const byHash = new Map(current.map((item) => [item.urlHash, item]))
  let added = 0

  for (const item of fetchedItems) {
    if (!byHash.has(item.urlHash)) added += 1
    byHash.set(item.urlHash, item)
  }

  const merged = limitNews(sortByPublished(Array.from(byHash.values())))
  writeStorageNoticias(merged)

  return {
    items: merged,
    added,
    fallback: false,
    report,
  }
}

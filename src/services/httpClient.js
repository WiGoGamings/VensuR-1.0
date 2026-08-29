const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const DEFAULT_API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 12_000)

let authToken = ''

function toAbsoluteUrl(path) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_BASE_URL}${path}`
}

function parseErrorMessage(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  return fallback
}

function normalizeTimeoutMs(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_API_TIMEOUT_MS
  return parsed
}

export function setAuthToken(token) {
  authToken = typeof token === 'string' ? token : ''
}

/**
 * @param {string} path
 * @param {{
 * method?: string,
 * body?: unknown,
 * isFormData?: boolean,
 * headers?: Record<string, string>,
 * timeoutMs?: number
 * }} [options]
 */
export async function httpRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    isFormData = false,
    headers = {},
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
  } = options

  const requestHeaders = {
    ...headers,
  }

  if (authToken) {
    requestHeaders.Authorization = `Bearer ${authToken}`
  }

  let requestBody = body

  if (body && !isFormData) {
    requestHeaders['Content-Type'] = 'application/json'
    requestBody = JSON.stringify(body)
  }

  const normalizedTimeout = normalizeTimeoutMs(timeoutMs)
  const abortController = new AbortController()
  const timeoutId =
    normalizedTimeout > 0
      ? setTimeout(() => {
          abortController.abort()
        }, normalizedTimeout)
      : null

  let response

  try {
    response = await fetch(toAbsoluteUrl(path), {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: abortController.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('La solicitud tardo demasiado. Intenta de nuevo.', { cause: error })
    }

    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : null

  if (!response.ok) {
    const error = new Error(parseErrorMessage(payload, 'No se pudo completar la solicitud'))

    if (payload && typeof payload === 'object') {
      Object.assign(error, payload)
    }

    throw error
  }

  return payload
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const DEFAULT_API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 12_000)
const REFRESH_PATH = '/api/auth/refresh'

let authToken = ''
let refreshInFlightPromise = null

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

function normalizePath(path) {
  return typeof path === 'string' ? path.split('?')[0] : ''
}

function shouldTryRefresh(path) {
  const normalized = normalizePath(path)

  if (!normalized) return false
  if (normalized === REFRESH_PATH) return false
  if (normalized === '/api/auth/login') return false
  if (normalized === '/api/auth/register') return false
  if (normalized === '/api/auth/verify-email') return false
  if (normalized === '/api/auth/resend-verification') return false
  if (normalized === '/api/auth/mfa/verify-login') return false
  if (normalized === '/api/auth/session/exchange') return false
  if (normalized === '/api/auth/logout') return false
  if (normalized.startsWith('/api/auth/oauth/')) return false

  return true
}

function createTimeoutController(timeoutMs) {
  const abortController = new AbortController()

  const timeoutId =
    timeoutMs > 0
      ? setTimeout(() => {
          abortController.abort()
        }, timeoutMs)
      : null

  return {
    abortController,
    clear() {
      if (timeoutId) clearTimeout(timeoutId)
    },
  }
}

async function parseJsonPayload(response) {
  const isJson = response.headers.get('content-type')?.includes('application/json')
  if (!isJson) return null

  try {
    return await response.json()
  } catch {
    return null
  }
}

async function performHttpCall(path, fetchOptions, timeoutMs) {
  const timeout = createTimeoutController(timeoutMs)
  let response

  try {
    response = await fetch(toAbsoluteUrl(path), {
      ...fetchOptions,
      signal: timeout.abortController.signal,
      credentials: 'include',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('La solicitud tardo demasiado. Intenta de nuevo.', { cause: error })
    }

    throw error
  } finally {
    timeout.clear()
  }

  const payload = await parseJsonPayload(response)

  return {
    response,
    payload,
  }
}

async function refreshSessionIfNeeded() {
  if (!refreshInFlightPromise) {
    refreshInFlightPromise = (async () => {
      try {
        const { response } = await performHttpCall(
          REFRESH_PATH,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          DEFAULT_API_TIMEOUT_MS,
        )
        return response.ok
      } catch {
        return false
      }
    })().finally(() => {
      refreshInFlightPromise = null
    })
  }

  return refreshInFlightPromise
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
  let result = await performHttpCall(
    path,
    {
      method,
      headers: requestHeaders,
      body: requestBody,
    },
    normalizedTimeout,
  )

  if (result.response.status === 401 && shouldTryRefresh(path)) {
    const refreshed = await refreshSessionIfNeeded()
    if (refreshed) {
      result = await performHttpCall(
        path,
        {
          method,
          headers: requestHeaders,
          body: requestBody,
        },
        normalizedTimeout,
      )
    }
  }

  const { response, payload } = result

  if (!response.ok) {
    const error = new Error(parseErrorMessage(payload, 'No se pudo completar la solicitud'))

    Object.assign(error, {
      status: response.status,
      statusText: response.statusText,
      requestPath: path,
    })

    if (payload && typeof payload === 'object') {
      Object.assign(error, payload)
    }

    throw error
  }

  return payload
}

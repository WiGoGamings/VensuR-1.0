import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

const RSS_PROXY_PATH = '/api/rss'
const RSS_TIMEOUT_MS = 8000
const API_TARGET = 'http://127.0.0.1:8787'
const ALLOWED_RSS_HOSTS = new Set([
  'elnacional.com',
  'www.elnacional.com',
  'efectococuyo.com',
  'www.efectococuyo.com',
  'talcualdigital.com',
  'www.talcualdigital.com',
  'runrun.es',
  'www.runrun.es',
])

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function isAllowedRssUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    const hostname = parsed.hostname.toLowerCase()

    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (!ALLOWED_RSS_HOSTS.has(hostname)) return null

    return parsed.toString()
  } catch {
    return null
  }
}

function mountRssProxy(middlewares) {
  middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith(RSS_PROXY_PATH)) return next()

    if (req.method !== 'GET') {
      writeJson(res, 405, { error: 'Metodo no permitido' })
      return
    }

    const requestUrl = new URL(req.url, 'http://localhost')
    const sourceUrl = requestUrl.searchParams.get('url')
    const targetUrl = sourceUrl ? isAllowedRssUrl(sourceUrl) : null

    if (!targetUrl) {
      writeJson(res, 400, { error: 'URL de feed no permitida' })
      return
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, RSS_TIMEOUT_MS)

    try {
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VensuR-RSS-Proxy/1.0',
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        writeJson(res, 502, { error: `Fuente RSS no disponible (${response.status})` })
        return
      }

      const body = await response.text()
      const contentType = response.headers.get('content-type') ?? 'application/xml; charset=utf-8'

      res.statusCode = 200
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'public, max-age=120')
      res.end(body)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        writeJson(res, 504, { error: 'Tiempo de espera agotado para feed RSS' })
      } else {
        writeJson(res, 502, { error: 'No se pudo consultar la fuente RSS' })
      }
    } finally {
      clearTimeout(timeoutId)
    }
  })
}

function rssProxyPlugin() {
  return {
    name: 'vensur-rss-proxy',
    configureServer(server) {
      mountRssProxy(server.middlewares)
    },
    configurePreviewServer(server) {
      mountRssProxy(server.middlewares)
    },
  }
}

function createApiProxyConfig() {
  return {
    '/api/auth': {
      target: API_TARGET,
      changeOrigin: true,
    },
    '/api/content': {
      target: API_TARGET,
      changeOrigin: true,
    },
    '/api/health': {
      target: API_TARGET,
      changeOrigin: true,
    },
    '/uploads': {
      target: API_TARGET,
      changeOrigin: true,
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: createApiProxyConfig(),
  },
  preview: {
    proxy: createApiProxyConfig(),
  },
  plugins: [
    rssProxyPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})

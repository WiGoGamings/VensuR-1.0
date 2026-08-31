import { writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

const RSS_PROXY_PATH = '/api/rss'
const RSS_TIMEOUT_MS = 8000
const API_TARGET = 'http://127.0.0.1:8787'
// Debe mantenerse alineado con ALLOWED_RSS_HOSTS de server/index.js.
const ALLOWED_RSS_BASE_HOSTS = [
  'elnacional.com',
  'efectococuyo.com',
  'talcualdigital.com',
  'runrun.es',
  'armando.info',
  'transparencia.org.ve',
  'provea.org',
  'foropenal.com',
]

function isAllowedRssHost(hostname) {
  return ALLOWED_RSS_BASE_HOSTS.some(
    (base) => hostname === base || hostname.endsWith(`.${base}`),
  )
}

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
    if (!isAllowedRssHost(hostname)) return null

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

/**
 * Genera dist/_redirects para Netlify a partir de API_PROXY_TARGET (la URL del
 * backend en Render). Así el sitio reenvía /api/* y /uploads/* al backend sin
 * tener que editar código: basta con poner esa variable en el panel de Netlify.
 */
function netlifyRedirectsPlugin() {
  return {
    name: 'vensur-netlify-redirects',
    apply: 'build',
    closeBundle() {
      const rawTarget = (process.env.API_PROXY_TARGET || process.env.VITE_API_BASE_URL || '').trim()
      const target = rawTarget.replace(/\/+$/, '')
      const lines = []

      if (target) {
        lines.push(`/api/*  ${target}/api/:splat  200`)
        lines.push(`/uploads/*  ${target}/uploads/:splat  200`)
      }
      // Fallback SPA (siempre al final).
      lines.push('/*  /index.html  200')

      const outDir = path.resolve(process.cwd(), 'dist')
      writeFileSync(path.join(outDir, '_redirects'), `${lines.join('\n')}\n`)
      console.log(
        target
          ? `[netlify] _redirects -> proxy de /api y /uploads a ${target}`
          : '[netlify] _redirects -> solo fallback SPA (define API_PROXY_TARGET para el backend)',
      )
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
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router')) return 'router'
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react'
            return 'vendor'
          }
          return undefined
        },
      },
    },
  },
  plugins: [
    rssProxyPlugin(),
    netlifyRedirectsPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
})

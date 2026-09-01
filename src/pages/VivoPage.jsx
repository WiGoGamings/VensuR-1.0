import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { listLiveSessions } from '../services/liveApi'
import './Pages.css'

const LIVE_SESSIONS_REFRESH_MS = 5000

function toLiveList(payload) {
  return Array.isArray(payload?.items) ? payload.items : []
}

function initialsOf(name) {
  const text = String(name || '').trim()
  if (!text) return 'VE'
  const parts = text.split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'VE'
}

export default function VivoPage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedSessionId = searchParams.get('sesion') || ''

  const [sessions, setSessions] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // Enlaces antiguos /vivo?sesion=ID -> nueva sala dedicada.
  useEffect(() => {
    if (requestedSessionId) {
      navigate(`/directo/${encodeURIComponent(requestedSessionId)}`, { replace: true })
    }
  }, [requestedSessionId, navigate])

  const refreshSessions = useCallback(
    async ({ silent = false } = {}) => {
      if (!isAuthenticated) {
        setSessions([])
        return
      }

      if (!silent) setIsLoading(true)

      try {
        const payload = await listLiveSessions()
        setSessions(toLiveList(payload))
        setErrorMessage('')
      } catch (error) {
        if (!silent) {
          setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar los en vivo.')
        }
      } finally {
        if (!silent) setIsLoading(false)
      }
    },
    [isAuthenticated],
  )

  useEffect(() => {
    if (!isAuthenticated) return undefined

    let alive = true

    async function pump(silent) {
      if (!alive) return
      await refreshSessions({ silent })
    }

    void pump(false)
    const timerId = setInterval(() => {
      void pump(true)
    }, LIVE_SESSIONS_REFRESH_MS)

    return () => {
      alive = false
      clearInterval(timerId)
    }
  }, [isAuthenticated, refreshSessions])

  if (!isAuthenticated) {
    return (
      <section className="feed route-page vivo-page">
        <article className="vivo-empty panel">
          <h2>En vivo ahora</h2>
          <p>Inicia sesión para ver transmisiones activas y entrar a las salas disponibles.</p>
          <Link to="/acceso">Ir a acceso</Link>
        </article>
      </section>
    )
  }

  return (
    <section className="feed route-page vivo-page">
      <header className="vivo-page-head">
        <h1>Transmisiones en vivo</h1>
        <button className="vivo-refresh" onClick={() => void refreshSessions({ silent: false })} type="button">
          Actualizar
        </button>
      </header>

      {isLoading ? <p className="route-message">Cargando transmisiones…</p> : null}
      {errorMessage ? <p className="route-message vivo-error">{errorMessage}</p> : null}

      {!isLoading && sessions.length === 0 ? (
        <article className="vivo-empty panel">
          <h2>No hay transmisiones activas</h2>
          <p>Cuando alguien inicie un en vivo, aparecerá aquí para entrar al directo.</p>
        </article>
      ) : null}

      <div className="vivo-directory">
        {sessions.map((session) => (
          <article className="vivo-directory-card" key={session.id}>
            <div className="vivo-directory-avatar" aria-hidden="true">
              {session.ownerAvatarUrl ? (
                <img alt="" src={session.ownerAvatarUrl} />
              ) : (
                initialsOf(session.ownerDisplayName || session.ownerUsername)
              )}
              <span className="vivo-directory-dot" />
            </div>

            <div className="vivo-directory-body">
              <div className="vivo-directory-top">
                <span className="tag live">EN VIVO</span>
                <small>{session.viewerCount || 0} viendo</small>
              </div>
              <b>{session.title}</b>
              <span>{session.ownerDisplayName || session.ownerUsername}</span>
            </div>

            {session.canView ? (
              <button
                className="vivo-btn danger"
                onClick={() => navigate(`/directo/${encodeURIComponent(session.id)}`)}
                type="button"
              >
                Entrar al directo
              </button>
            ) : (
              <Link
                className="vivo-btn"
                to={session.ownerUsername ? `/usuario/${encodeURIComponent(session.ownerUsername)}` : '/explorar'}
              >
                Seguir para entrar
              </Link>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

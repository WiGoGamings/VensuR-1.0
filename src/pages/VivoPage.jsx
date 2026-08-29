import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  getLiveSession,
  getLiveViewerAnswer,
  leaveLiveViewer,
  listFollowingLiveSessions,
  submitLiveViewerOffer,
} from '../services/liveApi'
import './Pages.css'

const LIVE_STUN_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}
const LIVE_SESSIONS_REFRESH_MS = 5000
const LIVE_ANSWER_POLL_MS = 1200

function waitForIceGatheringComplete(peerConnection, timeoutMs = 3500) {
  if (peerConnection.iceGatheringState === 'complete') {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange)
      resolve()
    }, timeoutMs)

    function onStateChange() {
      if (peerConnection.iceGatheringState !== 'complete') {
        return
      }

      clearTimeout(timeoutId)
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange)
      resolve()
    }

    peerConnection.addEventListener('icegatheringstatechange', onStateChange)
  })
}

function toLiveList(payload) {
  return Array.isArray(payload?.items) ? payload.items : []
}

export default function VivoPage() {
  const { isAuthenticated } = useAuth()
  const [searchParams] = useSearchParams()
  const requestedSessionId = searchParams.get('sesion') || ''

  const [sessions, setSessions] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const [isWatching, setIsWatching] = useState(false)
  const [activeViewerId, setActiveViewerId] = useState('')
  const [viewerStatus, setViewerStatus] = useState('')
  const [viewerError, setViewerError] = useState('')

  const viewerVideoRef = useRef(null)
  const viewerPeerRef = useRef(null)
  const answerPollTimerRef = useRef(null)
  const viewerTicketRef = useRef({ sessionId: '', viewerId: '' })

  const selectedSession = useMemo(() => {
    return sessions.find((item) => item.id === selectedSessionId) || null
  }, [sessions, selectedSessionId])

  const stopAnswerPolling = useCallback(() => {
    if (!answerPollTimerRef.current) return

    clearInterval(answerPollTimerRef.current)
    answerPollTimerRef.current = null
  }, [])

  const closePeerConnection = useCallback(() => {
    if (viewerPeerRef.current) {
      try {
        viewerPeerRef.current.close()
      } catch {
        // No-op.
      }
    }

    viewerPeerRef.current = null
  }, [])

  const clearViewerVideo = useCallback(() => {
    if (viewerVideoRef.current?.srcObject instanceof MediaStream) {
      const stream = viewerVideoRef.current.srcObject
      stream.getTracks().forEach((track) => track.stop())
    }

    if (viewerVideoRef.current) {
      viewerVideoRef.current.srcObject = null
    }
  }, [])

  const leaveCurrentLive = useCallback(async ({ notifyServer = true } = {}) => {
    stopAnswerPolling()

    const { sessionId, viewerId } = viewerTicketRef.current
    viewerTicketRef.current = { sessionId: '', viewerId: '' }

    if (notifyServer && sessionId && viewerId) {
      try {
        await leaveLiveViewer(sessionId, viewerId)
      } catch {
        // No-op.
      }
    }

    setActiveViewerId('')
    setIsWatching(false)
    setViewerStatus('')
    closePeerConnection()
    clearViewerVideo()
  }, [clearViewerVideo, closePeerConnection, stopAnswerPolling])

  const refreshSessions = useCallback(async ({ silent = false } = {}) => {
    if (!isAuthenticated) {
      setSessions([])
      return
    }

    if (!silent) {
      setIsLoading(true)
    }

    try {
      const payload = await listFollowingLiveSessions()
      const nextSessions = toLiveList(payload)

      setSessions(nextSessions)
      setErrorMessage('')

      const hasSelected = nextSessions.some((item) => item.id === selectedSessionId)

      if (requestedSessionId && nextSessions.some((item) => item.id === requestedSessionId)) {
        setSelectedSessionId(requestedSessionId)
      } else if (!hasSelected) {
        setSelectedSessionId(nextSessions[0]?.id || '')
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar los en vivo.')
      }
    } finally {
      if (!silent) {
        setIsLoading(false)
      }
    }
  }, [isAuthenticated, requestedSessionId, selectedSessionId])

  const startAnswerPolling = (sessionId, viewerId, peerConnection) => {
    stopAnswerPolling()

    const pollAnswer = async () => {
      try {
        const payload = await getLiveViewerAnswer(sessionId, viewerId)

        if (Number.isFinite(Number(payload?.viewerCount))) {
          const nextViewerCount = Number(payload.viewerCount)
          setSessions((current) =>
            current.map((item) =>
              item.id === sessionId
                ? { ...item, viewerCount: Math.max(0, nextViewerCount) }
                : item,
            ),
          )
        }

        if (payload?.ended) {
          setViewerError('La transmision termino.')
          await leaveCurrentLive({ notifyServer: false })
          await refreshSessions({ silent: true })
          return
        }

        if (!payload?.ready || !payload?.answer) {
          setViewerStatus('Conectando con la transmision en vivo...')
          return
        }

        if (!peerConnection.currentRemoteDescription) {
          await peerConnection.setRemoteDescription(payload.answer)
        }

        setIsWatching(true)
        setViewerStatus('Conectado en tiempo real.')
        stopAnswerPolling()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo conectar al en vivo.'
        setViewerError(message)
      }
    }

    void pollAnswer()
    answerPollTimerRef.current = setInterval(() => {
      void pollAnswer()
    }, LIVE_ANSWER_POLL_MS)
  }

  const onJoinLive = async (sessionId) => {
    if (!sessionId || isJoining) return

    setViewerError('')
    setViewerStatus('Preparando conexion al en vivo...')
    setIsJoining(true)

    await leaveCurrentLive({ notifyServer: true })

    try {
      const sessionPayload = await getLiveSession(sessionId)
      const session = sessionPayload?.session

      if (!session?.id) {
        throw new Error('No se pudo abrir esta transmision.')
      }

      setSelectedSessionId(session.id)

      const peerConnection = new RTCPeerConnection(LIVE_STUN_CONFIG)
      viewerPeerRef.current = peerConnection

      const fallbackRemoteStream = new MediaStream()
      if (viewerVideoRef.current) {
        viewerVideoRef.current.srcObject = fallbackRemoteStream
      }

      peerConnection.ontrack = (event) => {
        const stream = event.streams?.[0]

        if (stream && viewerVideoRef.current) {
          viewerVideoRef.current.srcObject = stream
          return
        }

        fallbackRemoteStream.addTrack(event.track)
      }

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState

        if (state === 'connected') {
          setIsWatching(true)
          setViewerStatus('Conectado en tiempo real.')
          return
        }

        if (['failed', 'disconnected', 'closed'].includes(state)) {
          setIsWatching(false)
          setViewerError('La conexion al en vivo se interrumpio.')
        }
      }

      peerConnection.addTransceiver('video', { direction: 'recvonly' })
      peerConnection.addTransceiver('audio', { direction: 'recvonly' })

      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      await waitForIceGatheringComplete(peerConnection)

      const finalOffer = peerConnection.localDescription
        ? {
            type: peerConnection.localDescription.type,
            sdp: peerConnection.localDescription.sdp,
          }
        : {
            type: offer.type,
            sdp: offer.sdp,
          }

      const joinPayload = await submitLiveViewerOffer(session.id, finalOffer)
      const viewerId = typeof joinPayload?.viewerId === 'string' ? joinPayload.viewerId : ''

      if (!viewerId) {
        throw new Error('No se pudo reservar cupo en la transmision.')
      }

      viewerTicketRef.current = { sessionId: session.id, viewerId }
      setActiveViewerId(viewerId)
      setViewerStatus('Esperando respuesta de la sala en vivo...')

      startAnswerPolling(session.id, viewerId, peerConnection)
    } catch (error) {
      setViewerError(error instanceof Error ? error.message : 'No se pudo abrir el en vivo.')
      await leaveCurrentLive({ notifyServer: false })
    } finally {
      setIsJoining(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    async function bootstrap() {
      if (!isAuthenticated) {
        setSessions([])
        setSelectedSessionId('')
        setErrorMessage('')
        return
      }

      await refreshSessions({ silent: false })
    }

    void bootstrap()

    const timerId = setInterval(() => {
      if (!isMounted || !isAuthenticated) return
      void refreshSessions({ silent: true })
    }, LIVE_SESSIONS_REFRESH_MS)

    return () => {
      isMounted = false
      clearInterval(timerId)
    }
  }, [isAuthenticated, refreshSessions])

  useEffect(() => {
    return () => {
      void leaveCurrentLive({ notifyServer: true })
    }
  }, [leaveCurrentLive])

  if (!isAuthenticated) {
    return (
      <section className="feed route-page vivo-page">
        <article className="vivo-empty panel">
          <h2>En vivo para seguidores</h2>
          <p>Inicia sesion para ver transmisiones en tiempo real de las cuentas que sigues.</p>
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

      <div className="vivo-layout">
        <article className="vivo-player panel">
          <div className="vivo-player-top">
            <span className="tag live">EN VIVO</span>
            <span>{selectedSession ? `${selectedSession.viewerCount || 0} viendo` : 'Sin sala seleccionada'}</span>
          </div>

          <h2>{selectedSession?.title || 'Selecciona una transmision'}</h2>
          <p>
            {selectedSession
              ? `Transmitido por ${selectedSession.ownerDisplayName || selectedSession.ownerUsername}`
              : 'Elige un en vivo para unirte en tiempo real.'}
          </p>

          <div className="vivo-player-screen">
            <video autoPlay className="vivo-player-video" controls playsInline ref={viewerVideoRef} />
            {!isWatching ? <span>Aun no estas conectado a una transmision en vivo.</span> : null}
          </div>

          {viewerStatus ? <p className="route-message vivo-ok">{viewerStatus}</p> : null}
          {viewerError ? <p className="route-message vivo-error">{viewerError}</p> : null}
          {errorMessage ? <p className="route-message vivo-error">{errorMessage}</p> : null}

          <div className="vivo-player-actions">
            <button
              className="vivo-btn danger"
              disabled={!selectedSession || isJoining}
              onClick={() => {
                if (selectedSession?.id) {
                  void onJoinLive(selectedSession.id)
                }
              }}
              type="button"
            >
              {isJoining ? 'Conectando...' : 'Ver en vivo'}
            </button>

            <button
              className="vivo-btn"
              disabled={!activeViewerId}
              onClick={() => {
                void leaveCurrentLive({ notifyServer: true })
              }}
              type="button"
            >
              Salir del en vivo
            </button>
          </div>
        </article>

        <aside className="vivo-list panel">
          <h3>Cuentas que sigues</h3>

          {isLoading ? <p className="route-message">Cargando transmisiones...</p> : null}

          {!isLoading && sessions.length === 0 ? (
            <p className="route-message">No hay transmisiones activas de cuentas que sigues.</p>
          ) : null}

          <div className="vivo-list-grid">
            {sessions.map((session) => (
              <article className="vivo-list-card" key={session.id}>
                <div className="vivo-list-card-head">
                  <span className="tag live">EN VIVO</span>
                  <small>{session.viewerCount || 0} viendo</small>
                </div>
                <b>{session.title}</b>
                <span>{session.ownerDisplayName || session.ownerUsername}</span>
                <button
                  className="vivo-btn"
                  onClick={() => {
                    setSelectedSessionId(session.id)
                    void onJoinLive(session.id)
                  }}
                  type="button"
                >
                  Entrar al directo
                </button>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}

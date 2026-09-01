import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getLiveSession,
  getLiveViewerAnswer,
  leaveLiveViewer,
  submitLiveViewerOffer,
} from '../services/liveApi'

const LIVE_STUN_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}
const LIVE_ANSWER_POLL_MS = 1200
// Tras conectar seguimos "haciendo ping" al servidor para que no nos considere
// inactivos y para enterarnos si la transmisión termina.
const LIVE_HEARTBEAT_MS = 8000
// `disconnected` suele recuperarse solo; damos margen antes de reconstruir.
const RECONNECT_DISCONNECT_GRACE_MS = 12000
const RECONNECT_MAX_ATTEMPTS = 20

// Logs opt-in: localStorage.setItem('vensur.live.debug','1')
function viewerLog(...args) {
  try {
    if (typeof window !== 'undefined' && window.localStorage?.getItem('vensur.live.debug') === '1') {
      console.log('[live-viewer]', ...args)
    }
  } catch {
    // no-op
  }
}

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
      if (peerConnection.iceGatheringState !== 'complete') return
      clearTimeout(timeoutId)
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange)
      resolve()
    }

    peerConnection.addEventListener('icegatheringstatechange', onStateChange)
  })
}

/**
 * Conexión WebRTC de solo recepción para ver una transmisión en vivo.
 * Reconecta sola si la conexión P2P se cae. Devuelve el ref del <video>,
 * el estado de conexión y las acciones join/leave.
 */
export default function useLiveViewer() {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const [isWatching, setIsWatching] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [ended, setEnded] = useState(false)

  const videoRef = useRef(null)
  const peerRef = useRef(null)
  const pollTimerRef = useRef(null)
  const disconnectTimerRef = useRef(null)
  const ticketRef = useRef({ sessionId: '', viewerId: '' })
  // Contador de "intento actual": cada join o leave lo incrementa. Cualquier
  // trabajo asíncrono en curso (offer, poll, handlers del PC) comprueba su
  // generación y se cancela solo si ya no es la vigente. Así StrictMode y las
  // reconexiones no dejan pollers/peers zombis ni bloquean nuevos intentos.
  const genRef = useRef(0)
  const streamEndedRef = useRef(false)
  const autoSessionIdRef = useRef('')
  const reconnectAttemptsRef = useRef(0)
  const joinRef = useRef(null)
  const scheduleReconnectRef = useRef(null)

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current)
      disconnectTimerRef.current = null
    }
  }, [])

  const stopPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const closePeer = useCallback(() => {
    if (peerRef.current) {
      try {
        peerRef.current.close()
      } catch {
        // No-op.
      }
    }
    peerRef.current = null
  }, [])

  const clearVideo = useCallback(() => {
    const node = videoRef.current
    if (node?.srcObject instanceof MediaStream) {
      node.srcObject.getTracks().forEach((track) => track.stop())
    }
    if (node) node.srcObject = null
  }, [])

  /** Desmonta la conexión actual (sin tocar el contador de generación). */
  const tearDownConnection = useCallback(
    async ({ notifyServer }) => {
      stopPollTimer()
      clearDisconnectTimer()

      const { sessionId, viewerId } = ticketRef.current
      ticketRef.current = { sessionId: '', viewerId: '' }
      if (notifyServer && sessionId && viewerId) {
        try {
          await leaveLiveViewer(sessionId, viewerId)
        } catch {
          // No-op.
        }
      }
      closePeer()
    },
    [clearDisconnectTimer, closePeer, stopPollTimer],
  )

  const leave = useCallback(
    async ({ notifyServer = true } = {}) => {
      genRef.current += 1
      autoSessionIdRef.current = ''
      await tearDownConnection({ notifyServer })
      setIsWatching(false)
      setStatus('')
      clearVideo()
    },
    [clearVideo, tearDownConnection],
  )

  const startAnswerPolling = useCallback(
    (gen, sessionId, viewerId, peerConnection) => {
      stopPollTimer()
      let phase = 'waiting'

      const runPoll = async () => {
        pollTimerRef.current = null
        if (gen !== genRef.current) return

        let payload
        try {
          payload = await getLiveViewerAnswer(sessionId, viewerId)
        } catch (pollError) {
          if (gen !== genRef.current) return
          const statusCode = Number(pollError?.status || 0)
          if (statusCode === 404 || statusCode === 410) {
            streamEndedRef.current = true
            setEnded(true)
            setError('La transmisión terminó.')
            await leave({ notifyServer: false })
            return
          }
          if (phase === 'waiting') {
            setError(pollError instanceof Error ? pollError.message : 'No se pudo conectar al en vivo.')
          }
          pollTimerRef.current = setTimeout(() => void runPoll(), LIVE_ANSWER_POLL_MS)
          return
        }

        if (gen !== genRef.current) return
        viewerLog('poll', { ready: payload?.ready, hasAnswer: !!payload?.answer, ended: payload?.ended, phase })

        if (Number.isFinite(Number(payload?.viewerCount))) {
          setViewerCount(Math.max(0, Number(payload.viewerCount)))
        }

        if (payload?.ended) {
          streamEndedRef.current = true
          setEnded(true)
          setError('La transmisión terminó.')
          await leave({ notifyServer: false })
          return
        }

        if (payload?.ready && payload?.answer) {
          try {
            if (!peerConnection.currentRemoteDescription) {
              await peerConnection.setRemoteDescription(payload.answer)
            }
          } catch (sdpError) {
            viewerLog('setRemoteDescription error', sdpError?.message)
          }
          if (gen !== genRef.current) return
          if (phase !== 'connected') {
            phase = 'connected'
            setIsWatching(true)
            setStatus('Conectado en tiempo real.')
          }
        } else if (phase === 'waiting') {
          setStatus('Conectando con la transmisión en vivo…')
        }

        const delay = phase === 'connected' ? LIVE_HEARTBEAT_MS : LIVE_ANSWER_POLL_MS
        pollTimerRef.current = setTimeout(() => void runPoll(), delay)
      }

      void runPoll()
    },
    [leave, stopPollTimer],
  )

  const join = useCallback(
    async (sessionId, { isReconnect = false } = {}) => {
      if (!sessionId) return

      const gen = (genRef.current += 1)
      const isCurrent = () => gen === genRef.current

      viewerLog('join()', { sessionId, isReconnect, gen })
      autoSessionIdRef.current = sessionId
      streamEndedRef.current = false
      clearDisconnectTimer()
      setError('')
      setEnded(false)
      setStatus(isReconnect ? 'Reconectando con la transmisión…' : 'Preparando conexión al en vivo…')
      setIsJoining(true)

      // Desmonta la conexión previa sin invalidar esta generación.
      await tearDownConnection({ notifyServer: true })

      let peerConnection = null
      try {
        if (!isCurrent()) return

        const sessionPayload = await getLiveSession(sessionId)
        if (!isCurrent()) return
        const session = sessionPayload?.session
        if (!session?.id) throw new Error('No se pudo abrir esta transmisión.')

        peerConnection = new RTCPeerConnection(LIVE_STUN_CONFIG)
        if (!isCurrent()) {
          try {
            peerConnection.close()
          } catch {
            // no-op
          }
          return
        }
        peerRef.current = peerConnection

        // En reconexión NO borramos el vídeo actual: seguimos mostrando el último
        // fotograma hasta que llegue la nueva pista, para no parpadear a "Conectando…".
        const fallbackStream = new MediaStream()
        if (videoRef.current && !isReconnect) videoRef.current.srcObject = fallbackStream

        peerConnection.ontrack = (event) => {
          viewerLog('ontrack', event.track.kind)
          if (!isCurrent() || peerRef.current !== peerConnection) return
          const stream = event.streams?.[0]
          if (stream && videoRef.current) {
            videoRef.current.srcObject = stream
            return
          }
          fallbackStream.addTrack(event.track)
        }

        peerConnection.oniceconnectionstatechange = () => {
          viewerLog('ice=', peerConnection.iceConnectionState)
        }

        peerConnection.onconnectionstatechange = () => {
          const state = peerConnection.connectionState
          viewerLog('conn=', state)
          if (!isCurrent() || peerRef.current !== peerConnection) return

          if (state === 'connected') {
            clearDisconnectTimer()
            reconnectAttemptsRef.current = 0
            setIsWatching(true)
            setError('')
            setStatus('Conectado en tiempo real.')
            return
          }

          if (state === 'failed') {
            clearDisconnectTimer()
            scheduleReconnectRef.current?.()
            return
          }

          if (state === 'disconnected') {
            setIsWatching(false)
            clearDisconnectTimer()
            disconnectTimerRef.current = setTimeout(() => {
              if (isCurrent() && peerConnection.connectionState !== 'connected') {
                scheduleReconnectRef.current?.()
              }
            }, RECONNECT_DISCONNECT_GRACE_MS)
          }
        }

        peerConnection.addTransceiver('video', { direction: 'recvonly' })
        peerConnection.addTransceiver('audio', { direction: 'recvonly' })

        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        await waitForIceGatheringComplete(peerConnection)
        if (!isCurrent()) return

        const finalOffer = peerConnection.localDescription
          ? { type: peerConnection.localDescription.type, sdp: peerConnection.localDescription.sdp }
          : { type: offer.type, sdp: offer.sdp }

        const joinPayload = await submitLiveViewerOffer(session.id, finalOffer)
        if (!isCurrent()) return
        const viewerId = typeof joinPayload?.viewerId === 'string' ? joinPayload.viewerId : ''
        viewerLog('offer enviada, viewerId=', viewerId)
        if (!viewerId) throw new Error('No se pudo reservar cupo en la transmisión.')

        ticketRef.current = { sessionId: session.id, viewerId }
        setStatus('Esperando respuesta de la sala en vivo…')
        startAnswerPolling(gen, session.id, viewerId, peerConnection)
      } catch (joinError) {
        if (!isCurrent()) return
        const statusCode = Number(joinError?.status || 0)
        if (statusCode === 404 || statusCode === 410) {
          streamEndedRef.current = true
          setEnded(true)
          setError('La transmisión terminó.')
          return
        }
        if (isReconnect) {
          setStatus('Reintentando conexión…')
          disconnectTimerRef.current = setTimeout(
            () => scheduleReconnectRef.current?.(),
            RECONNECT_DISCONNECT_GRACE_MS,
          )
        } else {
          setError(joinError instanceof Error ? joinError.message : 'No se pudo abrir el en vivo.')
        }
        if (peerConnection) {
          try {
            peerConnection.close()
          } catch {
            // no-op
          }
        }
      } finally {
        if (isCurrent()) setIsJoining(false)
      }
    },
    [clearDisconnectTimer, startAnswerPolling, tearDownConnection],
  )

  const scheduleReconnect = useCallback(() => {
    const sessionId = autoSessionIdRef.current
    viewerLog('scheduleReconnect', {
      sessionId,
      ended: streamEndedRef.current,
      attempts: reconnectAttemptsRef.current,
    })
    if (!sessionId || streamEndedRef.current) return
    if (reconnectAttemptsRef.current >= RECONNECT_MAX_ATTEMPTS) {
      setError('No se pudo mantener la conexión con el en vivo. Vuelve a intentarlo.')
      return
    }
    reconnectAttemptsRef.current += 1
    setStatus('Reconectando con la transmisión…')
    void joinRef.current?.(sessionId, { isReconnect: true })
  }, [])

  useEffect(() => {
    joinRef.current = join
    scheduleReconnectRef.current = scheduleReconnect
  }, [join, scheduleReconnect])

  useEffect(() => {
    return () => {
      void leave({ notifyServer: true })
    }
  }, [leave])

  return {
    videoRef,
    status,
    error,
    isJoining,
    isWatching,
    viewerCount,
    ended,
    join,
    leave,
    setViewerCount,
    setEnded,
  }
}

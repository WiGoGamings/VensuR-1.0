/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createLiveSession,
  getLiveSessionOffers,
  stopLiveSession,
  submitLiveViewerAnswer,
} from '../services/liveApi'

const LIVE_STUN_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const OFFERS_POLL_INTERVAL_MS = 1100
const ICE_GATHERING_TIMEOUT_MS = 3500

const LiveBroadcastContext = createContext(null)

function waitForIceGatheringComplete(peerConnection, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
  if (peerConnection.iceGatheringState === 'complete') return Promise.resolve()

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      peerConnection.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }, timeoutMs)

    function onChange() {
      if (peerConnection.iceGatheringState !== 'complete') return
      clearTimeout(timeoutId)
      peerConnection.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }

    peerConnection.addEventListener('icegatheringstatechange', onChange)
  })
}

export function LiveBroadcastProvider({ children }) {
  // Refs: sobreviven a cualquier re-render y a que se cierren los paneles.
  const streamRef = useRef(null)
  const peerByViewerIdRef = useRef(new Map())
  const pollingTimerRef = useRef(null)
  const processingOffersRef = useRef(new Set())
  const sessionIdRef = useRef('')
  const elapsedTimerRef = useRef(null)

  const [stream, setStream] = useState(null)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [includeAudio, setIncludeAudio] = useState(true)

  const [isPreparing, setIsPreparing] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isLive, setIsLive] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  const [sessionId, setSessionId] = useState('')
  const [sharePath, setSharePath] = useState('/vivo')
  const [meta, setMeta] = useState({ title: '', description: '' })
  const [viewerCount, setViewerCount] = useState(0)
  const [viewers, setViewers] = useState([])
  const [startedAt, setStartedAt] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const [isStudioOpen, setIsStudioOpen] = useState(false)
  const [isMonitorOpen, setIsMonitorOpen] = useState(false)

  const stopPollingInternal = useCallback(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current)
      pollingTimerRef.current = null
    }
  }, [])

  const closePeersInternal = useCallback(() => {
    for (const peer of peerByViewerIdRef.current.values()) {
      try {
        peer.close()
      } catch {
        // no-op
      }
    }
    peerByViewerIdRef.current.clear()
    processingOffersRef.current.clear()
  }, [])

  const stopStreamInternal = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setStream(null)
    setIsCameraReady(false)
  }, [])

  const teardown = useCallback(
    (statusMessage) => {
      sessionIdRef.current = ''
      stopPollingInternal()
      closePeersInternal()
      stopStreamInternal()
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }
      setIsLive(false)
      setIsPreparing(false)
      setIsStarting(false)
      setIsStopping(false)
      setSessionId('')
      setViewerCount(0)
      setViewers([])
      setStartedAt(0)
      setElapsedSec(0)
      setSharePath('/vivo')
      setStatus(statusMessage || '')
    },
    [closePeersInternal, stopPollingInternal, stopStreamInternal],
  )

  const prepareCamera = useCallback(
    async (options = {}) => {
      const wantsAudio = options.includeAudio ?? includeAudio
      setIncludeAudio(wantsAudio)
      setError('')

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('Tu navegador no permite usar cámara para en vivo.')
        return null
      }

      setIsPreparing(true)
      setStatus('Solicitando permisos de cámara y micrófono...')

      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
        }

        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' } },
          audio: wantsAudio,
        })

        streamRef.current = nextStream
        setStream(nextStream)
        setIsCameraReady(true)
        setStatus('Cámara lista. Pulsa "Iniciar en vivo".')
        return nextStream
      } catch (cameraError) {
        const byName = {
          NotAllowedError: 'Permiso denegado. Debes permitir cámara y micrófono.',
          NotFoundError: 'No se detectó cámara o micrófono.',
          NotReadableError: 'La cámara está en uso por otra aplicación.',
        }
        const name = cameraError && typeof cameraError === 'object' ? cameraError.name : ''
        setError(byName[name] || 'No se pudo iniciar la cámara.')
        setStatus('')
        stopStreamInternal()
        return null
      } finally {
        setIsPreparing(false)
      }
    },
    [includeAudio, stopStreamInternal],
  )

  const handleIncomingOffer = useCallback(async (activeSessionId, item) => {
    const viewerId = typeof item?.viewerId === 'string' ? item.viewerId : ''
    const offer = item?.offer

    if (!viewerId || !offer || offer.type !== 'offer' || typeof offer.sdp !== 'string') return
    if (processingOffersRef.current.has(viewerId)) return

    const localStream = streamRef.current
    if (!localStream) return

    processingOffersRef.current.add(viewerId)
    let peer = null

    try {
      peer = new RTCPeerConnection(LIVE_STUN_CONFIG)
      localStream.getTracks().forEach((track) => peer.addTrack(track, localStream))

      peer.onconnectionstatechange = () => {
        if (!['failed', 'disconnected', 'closed'].includes(peer.connectionState)) return
        if (peerByViewerIdRef.current.get(viewerId) === peer) {
          peerByViewerIdRef.current.delete(viewerId)
          setViewers((current) => current.filter((v) => v.viewerId !== viewerId))
        }
        try {
          peer.close()
        } catch {
          // no-op
        }
      }

      await peer.setRemoteDescription(offer)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      await waitForIceGatheringComplete(peer)

      const finalAnswer = peer.localDescription
        ? { type: peer.localDescription.type, sdp: peer.localDescription.sdp }
        : { type: answer.type, sdp: answer.sdp }

      const response = await submitLiveViewerAnswer(activeSessionId, viewerId, finalAnswer)
      peerByViewerIdRef.current.set(viewerId, peer)

      setViewers((current) => {
        if (current.some((v) => v.viewerId === viewerId)) return current
        const info = item?.viewer || {}
        return [
          ...current,
          {
            viewerId,
            username: info.username || '',
            displayName: info.displayName || 'Espectador',
            avatarUrl: info.avatarUrl || '',
          },
        ]
      })

      if (Number.isFinite(Number(response?.viewerCount))) {
        setViewerCount(Number(response.viewerCount))
      }
    } catch {
      if (peer) {
        try {
          peer.close()
        } catch {
          // no-op
        }
      }
    } finally {
      processingOffersRef.current.delete(viewerId)
    }
  }, [])

  const startPolling = useCallback(
    (activeSessionId) => {
      stopPollingInternal()

      const poll = async () => {
        try {
          const payload = await getLiveSessionOffers(activeSessionId)
          const count = Number(payload?.viewerCount ?? 0)
          if (Number.isFinite(count)) setViewerCount(Math.max(0, count))

          const items = Array.isArray(payload?.items) ? payload.items : []
          for (const item of items) {
            await handleIncomingOffer(activeSessionId, item)
          }
        } catch (pollError) {
          const message = pollError instanceof Error ? pollError.message : 'No se pudo sincronizar el en vivo.'
          setError(message)
          if (message.toLowerCase().includes('ya no esta activa') || message.toLowerCase().includes('finaliz')) {
            teardown('La transmisión finalizó.')
          }
        }
      }

      void poll()
      pollingTimerRef.current = setInterval(() => void poll(), OFFERS_POLL_INTERVAL_MS)
    },
    [handleIncomingOffer, stopPollingInternal, teardown],
  )

  const startBroadcast = useCallback(
    async ({ title, description }) => {
      const cleanTitle = (title || '').trim()
      if (!cleanTitle) {
        setError('Agrega un título para iniciar el en vivo.')
        return false
      }
      if (!streamRef.current || !isCameraReady) {
        setError('Primero configura la cámara.')
        return false
      }
      if (isStarting || isLive) return false

      setIsStarting(true)
      setError('')
      let createdId = ''

      try {
        const payload = await createLiveSession({ title: cleanTitle, description: (description || '').trim() })
        const session = payload?.session
        if (!session?.id) throw new Error('No se pudo abrir la sala en vivo.')

        createdId = session.id
        sessionIdRef.current = createdId

        const startTs = Date.now()
        setSessionId(createdId)
        setMeta({ title: cleanTitle, description: (description || '').trim() })
        setSharePath(payload?.sharePath || `/vivo?sesion=${encodeURIComponent(createdId)}`)
        setViewerCount(Math.max(0, Number(session.viewerCount ?? 0) || 0))
        setViewers([])
        setStartedAt(startTs)
        setElapsedSec(0)
        setIsLive(true)
        setStatus('En vivo. Tus seguidores ya pueden verte.')

        if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = setInterval(() => {
          setElapsedSec(Math.floor((Date.now() - startTs) / 1000))
        }, 1000)

        startPolling(createdId)
        setIsStudioOpen(false)
        setIsMonitorOpen(true)
        return true
      } catch (startError) {
        if (createdId) {
          try {
            await stopLiveSession(createdId)
          } catch {
            // no-op
          }
        }
        sessionIdRef.current = ''
        setError(startError instanceof Error ? startError.message : 'No se pudo iniciar el en vivo.')
        return false
      } finally {
        setIsStarting(false)
      }
    },
    [isCameraReady, isLive, isStarting, startPolling],
  )

  const stopBroadcast = useCallback(async () => {
    if (isStopping) return
    setIsStopping(true)
    setError('')

    const id = sessionIdRef.current
    try {
      if (id) await stopLiveSession(id)
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : 'No se pudo detener el en vivo.')
    } finally {
      teardown('Transmisión finalizada.')
      setIsMonitorOpen(false)
    }
  }, [isStopping, teardown])

  const clearError = useCallback(() => setError(''), [])
  const openStudio = useCallback(() => {
    setError('')
    setIsStudioOpen(true)
  }, [])
  const closeStudio = useCallback(() => setIsStudioOpen(false), [])
  const openMonitor = useCallback(() => setIsMonitorOpen(true), [])
  const closeMonitor = useCallback(() => setIsMonitorOpen(false), [])

  // Aviso al cerrar/recargar la pestaña mientras se transmite.
  useEffect(() => {
    if (!isLive) return undefined
    const onBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isLive])

  // Limpieza solo cuando la app entera se desmonta (cierre real de pestaña).
  useEffect(() => {
    const peers = peerByViewerIdRef.current
    return () => {
      const id = sessionIdRef.current
      if (id) void stopLiveSession(id).catch(() => {})
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current)
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
      streamRef.current?.getTracks().forEach((track) => track.stop())
      for (const peer of peers.values()) {
        try {
          peer.close()
        } catch {
          // no-op
        }
      }
      peers.clear()
    }
  }, [])

  const value = useMemo(
    () => ({
      // estado
      stream,
      isCameraReady,
      includeAudio,
      isPreparing,
      isStarting,
      isLive,
      isStopping,
      sessionId,
      sharePath,
      meta,
      viewerCount,
      viewers,
      startedAt,
      elapsedSec,
      status,
      error,
      isStudioOpen,
      isMonitorOpen,
      // acciones
      setIncludeAudio,
      prepareCamera,
      startBroadcast,
      stopBroadcast,
      openStudio,
      closeStudio,
      openMonitor,
      closeMonitor,
      clearError,
    }),
    [
      stream, isCameraReady, includeAudio, isPreparing, isStarting, isLive, isStopping,
      sessionId, sharePath, meta, viewerCount, viewers, startedAt, elapsedSec, status, error,
      isStudioOpen, isMonitorOpen, prepareCamera, startBroadcast, stopBroadcast,
      openStudio, closeStudio, openMonitor, closeMonitor, clearError,
    ],
  )

  return <LiveBroadcastContext.Provider value={value}>{children}</LiveBroadcastContext.Provider>
}

export function useLiveBroadcast() {
  const context = useContext(LiveBroadcastContext)
  if (!context) throw new Error('useLiveBroadcast debe usarse dentro de LiveBroadcastProvider')
  return context
}

export function formatElapsed(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

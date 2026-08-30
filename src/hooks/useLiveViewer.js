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
 * Devuelve el ref del <video>, estado de conexión y las acciones join/leave.
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
  const answerPollTimerRef = useRef(null)
  const ticketRef = useRef({ sessionId: '', viewerId: '' })
  // Guarda de reentrada por ref: mantiene estable la identidad de `join`
  // (si dependiera del estado `isJoining`, un efecto que lo llame entraría en bucle).
  const isJoiningRef = useRef(false)

  const stopAnswerPolling = useCallback(() => {
    if (!answerPollTimerRef.current) return
    clearInterval(answerPollTimerRef.current)
    answerPollTimerRef.current = null
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

  const leave = useCallback(
    async ({ notifyServer = true } = {}) => {
      stopAnswerPolling()

      const { sessionId, viewerId } = ticketRef.current
      ticketRef.current = { sessionId: '', viewerId: '' }

      if (notifyServer && sessionId && viewerId) {
        try {
          await leaveLiveViewer(sessionId, viewerId)
        } catch {
          // No-op.
        }
      }

      setIsWatching(false)
      setStatus('')
      closePeer()
      clearVideo()
    },
    [clearVideo, closePeer, stopAnswerPolling],
  )

  const startAnswerPolling = useCallback(
    (sessionId, viewerId, peerConnection) => {
      stopAnswerPolling()

      const pollAnswer = async () => {
        try {
          const payload = await getLiveViewerAnswer(sessionId, viewerId)

          if (Number.isFinite(Number(payload?.viewerCount))) {
            setViewerCount(Math.max(0, Number(payload.viewerCount)))
          }

          if (payload?.ended) {
            setEnded(true)
            setError('La transmisión terminó.')
            await leave({ notifyServer: false })
            return
          }

          if (!payload?.ready || !payload?.answer) {
            setStatus('Conectando con la transmisión en vivo…')
            return
          }

          if (!peerConnection.currentRemoteDescription) {
            await peerConnection.setRemoteDescription(payload.answer)
          }

          setIsWatching(true)
          setStatus('Conectado en tiempo real.')
          stopAnswerPolling()
        } catch (pollError) {
          setError(pollError instanceof Error ? pollError.message : 'No se pudo conectar al en vivo.')
        }
      }

      void pollAnswer()
      answerPollTimerRef.current = setInterval(() => {
        void pollAnswer()
      }, LIVE_ANSWER_POLL_MS)
    },
    [leave, stopAnswerPolling],
  )

  const join = useCallback(
    async (sessionId) => {
      if (!sessionId || isJoiningRef.current) return

      isJoiningRef.current = true
      setError('')
      setEnded(false)
      setStatus('Preparando conexión al en vivo…')
      setIsJoining(true)

      await leave({ notifyServer: true })

      try {
        const sessionPayload = await getLiveSession(sessionId)
        const session = sessionPayload?.session
        if (!session?.id) throw new Error('No se pudo abrir esta transmisión.')

        const peerConnection = new RTCPeerConnection(LIVE_STUN_CONFIG)
        peerRef.current = peerConnection

        const fallbackStream = new MediaStream()
        if (videoRef.current) videoRef.current.srcObject = fallbackStream

        peerConnection.ontrack = (event) => {
          const stream = event.streams?.[0]
          if (stream && videoRef.current) {
            videoRef.current.srcObject = stream
            return
          }
          fallbackStream.addTrack(event.track)
        }

        peerConnection.onconnectionstatechange = () => {
          const state = peerConnection.connectionState
          if (state === 'connected') {
            setIsWatching(true)
            setStatus('Conectado en tiempo real.')
            return
          }
          if (['failed', 'disconnected', 'closed'].includes(state)) {
            setIsWatching(false)
            if (state !== 'closed') setError('La conexión al en vivo se interrumpió.')
          }
        }

        peerConnection.addTransceiver('video', { direction: 'recvonly' })
        peerConnection.addTransceiver('audio', { direction: 'recvonly' })

        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        await waitForIceGatheringComplete(peerConnection)

        const finalOffer = peerConnection.localDescription
          ? { type: peerConnection.localDescription.type, sdp: peerConnection.localDescription.sdp }
          : { type: offer.type, sdp: offer.sdp }

        const joinPayload = await submitLiveViewerOffer(session.id, finalOffer)
        const viewerId = typeof joinPayload?.viewerId === 'string' ? joinPayload.viewerId : ''
        if (!viewerId) throw new Error('No se pudo reservar cupo en la transmisión.')

        ticketRef.current = { sessionId: session.id, viewerId }
        setStatus('Esperando respuesta de la sala en vivo…')
        startAnswerPolling(session.id, viewerId, peerConnection)
      } catch (joinError) {
        setError(joinError instanceof Error ? joinError.message : 'No se pudo abrir el en vivo.')
        await leave({ notifyServer: false })
      } finally {
        isJoiningRef.current = false
        setIsJoining(false)
      }
    },
    [leave, startAnswerPolling],
  )

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

import './Composer.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  createLiveSession,
  getLiveSessionOffers,
  stopLiveSession,
  submitLiveViewerAnswer,
} from '../../services/liveApi'
import { createStory } from '../../services/storiesApi'
import StoryStudio from '../composer/StoryStudio'
import PostComposer from '../composer/PostComposer'

const LIVE_STUN_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}
const LIVE_OFFERS_POLL_INTERVAL_MS = 1100
const ICE_GATHERING_TIMEOUT_MS = 3500

function waitForIceGatheringComplete(peerConnection, timeoutMs = ICE_GATHERING_TIMEOUT_MS) {
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

function initialsOf(user) {
  const source = user?.displayName || user?.username || 'VR'
  return source.slice(0, 2).toUpperCase()
}

/**
 * @param {{
 * isAuthenticated: boolean,
 * onPostCreated?: (post: import('../../data/feedData').Post) => void
 * }} props
 */
export default function Composer({ isAuthenticated, onPostCreated }) {
  const { user } = useAuth()

  const [isPostComposerOpen, setIsPostComposerOpen] = useState(false)
  const [isStoryStudioOpen, setIsStoryStudioOpen] = useState(false)
  const [isLiveStudioOpen, setIsLiveStudioOpen] = useState(false)

  const [composerError, setComposerError] = useState('')
  const [composerStatus, setComposerStatus] = useState('')

  const livePreviewVideoRef = useRef(null)
  const liveBroadcastStreamRef = useRef(null)
  const livePeerByViewerIdRef = useRef(new Map())
  const liveOfferPollingTimerRef = useRef(null)
  const processingViewerOfferIdsRef = useRef(new Set())
  const liveSessionIdRef = useRef('')

  const [liveDraft, setLiveDraft] = useState({
    title: '',
    description: '',
    includeAudio: true,
    acceptedTerms: false,
  })
  const [isLivePreparing, setIsLivePreparing] = useState(false)
  const [isLiveStarting, setIsLiveStarting] = useState(false)
  const [isLiveActive, setIsLiveActive] = useState(false)
  const [isLiveStopping, setIsLiveStopping] = useState(false)
  const [isLiveStreamReady, setIsLiveStreamReady] = useState(false)
  const [liveViewerCount, setLiveViewerCount] = useState(0)
  const [liveStatus, setLiveStatus] = useState('Configura tu cámara para empezar.')
  const [liveError, setLiveError] = useState('')
  const [liveSharePath, setLiveSharePath] = useState('/vivo')

  const avatarText = useMemo(() => initialsOf(user), [user])

  const promptName = useMemo(() => {
    const source = user?.displayName || user?.username || ''
    if (!source) return 'Comunidad'
    const firstName = source.trim().split(/\s+/)[0] || source
    return firstName.slice(0, 18)
  }, [user?.displayName, user?.username])

  useEffect(() => {
    const livePreviewVideoNode = livePreviewVideoRef.current
    const livePeerConnections = livePeerByViewerIdRef.current
    const processingViewerOfferIds = processingViewerOfferIdsRef.current

    return () => {
      const liveSessionId = liveSessionIdRef.current
      if (liveSessionId) {
        void stopLiveSession(liveSessionId).catch(() => {})
      }

      const liveStream = liveBroadcastStreamRef.current
      if (liveStream) {
        liveStream.getTracks().forEach((track) => track.stop())
        liveBroadcastStreamRef.current = null
      }

      if (livePreviewVideoNode) {
        livePreviewVideoNode.srcObject = null
      }

      if (liveOfferPollingTimerRef.current) {
        clearInterval(liveOfferPollingTimerRef.current)
        liveOfferPollingTimerRef.current = null
      }

      for (const connection of livePeerConnections.values()) {
        try {
          connection.close()
        } catch {
          // No-op.
        }
      }

      livePeerConnections.clear()
      processingViewerOfferIds.clear()
    }
  }, [])

  const stopLiveOfferPolling = () => {
    if (!liveOfferPollingTimerRef.current) return
    clearInterval(liveOfferPollingTimerRef.current)
    liveOfferPollingTimerRef.current = null
  }

  const stopLivePreviewStream = () => {
    const stream = liveBroadcastStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      liveBroadcastStreamRef.current = null
    }

    if (livePreviewVideoRef.current) {
      livePreviewVideoRef.current.srcObject = null
    }

    setIsLiveStreamReady(false)
  }

  const closeLivePeerConnections = () => {
    for (const peerConnection of livePeerByViewerIdRef.current.values()) {
      try {
        peerConnection.close()
      } catch {
        // No-op.
      }
    }

    livePeerByViewerIdRef.current.clear()
    processingViewerOfferIdsRef.current.clear()
  }

  const stopLiveBroadcastSession = async ({
    notifyServer = true,
    statusMessage = 'Transmisión detenida.',
  } = {}) => {
    if (isLiveStopping) return

    setIsLiveStopping(true)
    setLiveError('')

    const sessionId = liveSessionIdRef.current

    try {
      if (notifyServer && sessionId) {
        await stopLiveSession(sessionId)
      }
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : 'No se pudo detener el en vivo.')
    } finally {
      liveSessionIdRef.current = ''
      stopLiveOfferPolling()
      closeLivePeerConnections()
      stopLivePreviewStream()

      setIsLiveActive(false)
      setIsLivePreparing(false)
      setIsLiveStarting(false)
      setLiveViewerCount(0)
      setLiveStatus(statusMessage)
      setIsLiveStopping(false)
    }
  }

  const resetLiveStudioState = ({ clearDraft = false } = {}) => {
    liveSessionIdRef.current = ''
    stopLiveOfferPolling()
    closeLivePeerConnections()
    stopLivePreviewStream()

    setIsLivePreparing(false)
    setIsLiveStarting(false)
    setIsLiveActive(false)
    setIsLiveStopping(false)
    setLiveViewerCount(0)
    setLiveError('')
    setLiveStatus('Configura tu cámara para empezar.')
    setLiveSharePath('/vivo')

    if (clearDraft) {
      setLiveDraft({ title: '', description: '', includeAudio: true, acceptedTerms: false })
    }
  }

  const closeLiveStudio = () => {
    if (isLiveActive) {
      setLiveError('Primero finaliza la transmisión para cerrar.')
      return
    }
    resetLiveStudioState()
    setIsLiveStudioOpen(false)
  }

  const openCreator = (type) => {
    if (!isAuthenticated) {
      setComposerError('Debes iniciar sesión para crear contenido desde Inicio.')
      return
    }

    setComposerError('')
    setComposerStatus('')

    if (type === 'story') {
      setIsStoryStudioOpen(true)
    } else if (type === 'live') {
      resetLiveStudioState()
      setIsLiveStudioOpen(true)
    } else {
      setIsPostComposerOpen(true)
    }
  }

  const publishStoryFromStudio = async ({ mediaFile, title, description, metadata }) => {
    try {
      const response = await createStory({
        title: title || 'Historia',
        description: description || '',
        mediaFile,
        metadata,
      })
      if (!response?.story) return false
      setComposerStatus('Historia publicada correctamente.')
      return true
    } catch {
      return false
    }
  }

  const onPrepareLiveCamera = async () => {
    if (!liveDraft.acceptedTerms) {
      setLiveError('Debes aceptar las condiciones para iniciar cámara y micrófono.')
      return
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setLiveError('Tu navegador no permite iniciar cámara para en vivo.')
      return
    }

    setIsLivePreparing(true)
    setLiveError('')
    setLiveStatus('Solicitando permisos de cámara y micrófono...')

    try {
      stopLivePreviewStream()

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' } },
        audio: liveDraft.includeAudio,
      })

      liveBroadcastStreamRef.current = stream

      if (livePreviewVideoRef.current) {
        livePreviewVideoRef.current.srcObject = stream
        try {
          await livePreviewVideoRef.current.play()
        } catch {
          // Algunos navegadores necesitan gesto extra para iniciar preview.
        }
      }

      setIsLiveStreamReady(true)
      setLiveStatus('Cámara lista. Pulsa "Iniciar en vivo" para transmitir.')
    } catch (error) {
      const messageByCode = {
        NotAllowedError: 'Permiso denegado. Debes permitir cámara y micrófono para en vivo.',
        NotFoundError: 'No se detectó cámara o micrófono disponible.',
        NotReadableError: 'Cámara o micrófono está siendo usado por otra aplicación.',
      }

      const errorName = error && typeof error === 'object' ? error.name : ''
      setLiveError(messageByCode[errorName] || 'No se pudo iniciar cámara para en vivo.')
      setLiveStatus('')
      stopLivePreviewStream()
    } finally {
      setIsLivePreparing(false)
    }
  }

  const handleIncomingViewerOffer = async (sessionId, item) => {
    const viewerId = typeof item?.viewerId === 'string' ? item.viewerId : ''
    const offer = item?.offer

    if (!viewerId || !offer || offer.type !== 'offer' || typeof offer.sdp !== 'string') {
      return
    }

    if (processingViewerOfferIdsRef.current.has(viewerId)) {
      return
    }

    const localStream = liveBroadcastStreamRef.current
    if (!localStream) {
      return
    }

    processingViewerOfferIdsRef.current.add(viewerId)

    let peerConnection = null

    try {
      peerConnection = new RTCPeerConnection(LIVE_STUN_CONFIG)

      localStream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStream)
      })

      peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState
        if (!['failed', 'disconnected', 'closed'].includes(state)) return

        const current = livePeerByViewerIdRef.current.get(viewerId)
        if (current === peerConnection) {
          livePeerByViewerIdRef.current.delete(viewerId)
        }

        try {
          peerConnection.close()
        } catch {
          // No-op.
        }
      }

      await peerConnection.setRemoteDescription(offer)

      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)
      await waitForIceGatheringComplete(peerConnection)

      const finalAnswer = peerConnection.localDescription
        ? {
            type: peerConnection.localDescription.type,
            sdp: peerConnection.localDescription.sdp,
          }
        : {
            type: answer.type,
            sdp: answer.sdp,
          }

      const response = await submitLiveViewerAnswer(sessionId, viewerId, finalAnswer)
      livePeerByViewerIdRef.current.set(viewerId, peerConnection)

      if (Number.isFinite(Number(response?.viewerCount))) {
        setLiveViewerCount(Number(response.viewerCount))
      }
    } catch {
      if (peerConnection) {
        try {
          peerConnection.close()
        } catch {
          // No-op.
        }
      }
    } finally {
      processingViewerOfferIdsRef.current.delete(viewerId)
    }
  }

  const startLiveOfferPolling = (sessionId) => {
    stopLiveOfferPolling()

    const pollOffers = async () => {
      try {
        const payload = await getLiveSessionOffers(sessionId)
        const viewers = Number(payload?.viewerCount ?? 0)

        if (Number.isFinite(viewers)) {
          setLiveViewerCount(Math.max(0, viewers))
        }

        const items = Array.isArray(payload?.items) ? payload.items : []
        for (const item of items) {
          await handleIncomingViewerOffer(sessionId, item)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No se pudo sincronizar en vivo.'
        setLiveError(message)

        if (message.toLowerCase().includes('ya no esta activa')) {
          void stopLiveBroadcastSession({
            notifyServer: false,
            statusMessage: 'La transmisión finalizó.',
          })
        }
      }
    }

    void pollOffers()
    liveOfferPollingTimerRef.current = setInterval(() => {
      void pollOffers()
    }, LIVE_OFFERS_POLL_INTERVAL_MS)
  }

  const onStartLiveBroadcast = async (event) => {
    event.preventDefault()

    const title = liveDraft.title.trim()
    if (!title) {
      setLiveError('Agrega un título para iniciar el en vivo.')
      return
    }

    if (!isLiveStreamReady || !liveBroadcastStreamRef.current) {
      setLiveError('Primero configura la cámara y los permisos.')
      return
    }

    if (isLiveStarting || isLiveActive) {
      return
    }

    setIsLiveStarting(true)
    setLiveError('')

    let createdSessionId = ''

    try {
      const payload = await createLiveSession({
        title,
        description: liveDraft.description.trim(),
      })

      const session = payload?.session
      if (!session?.id) {
        throw new Error('No se pudo abrir la sala en vivo.')
      }

      createdSessionId = session.id
      liveSessionIdRef.current = createdSessionId

      const fallbackPath = `/vivo?sesion=${encodeURIComponent(createdSessionId)}`
      setLiveSharePath(typeof payload?.sharePath === 'string' && payload.sharePath ? payload.sharePath : fallbackPath)

      const viewers = Number(session.viewerCount ?? 0)
      setLiveViewerCount(Number.isFinite(viewers) ? Math.max(0, viewers) : 0)
      setIsLiveActive(true)
      setLiveStatus('En vivo activo. Tus seguidores ya pueden verlo en tiempo real.')

      startLiveOfferPolling(createdSessionId)
    } catch (error) {
      if (createdSessionId) {
        try {
          await stopLiveSession(createdSessionId)
        } catch {
          // No-op.
        }
      }

      liveSessionIdRef.current = ''
      setLiveError(error instanceof Error ? error.message : 'No se pudo iniciar el en vivo.')
    } finally {
      setIsLiveStarting(false)
    }
  }

  const onStopLiveBroadcast = async () => {
    if (!isLiveActive) {
      if (isLiveStreamReady) {
        stopLivePreviewStream()
      }
      setLiveStatus('Vista previa detenida.')
      return
    }

    await stopLiveBroadcastSession({
      notifyServer: true,
      statusMessage: 'Transmisión detenida correctamente.',
    })
  }

  const updateLiveDraft = (patch) => setLiveDraft((current) => ({ ...current, ...patch }))

  return (
    <>
      <section className="composer composer-compact" aria-label="Crear contenido rapido">
        <div className="avatar user-avatar">
          {user?.avatarUrl ? (
            <img alt="" aria-hidden="true" className="composer-avatar-img" loading="lazy" src={user.avatarUrl} />
          ) : (
            avatarText
          )}
        </div>

        <div className="composer-compact-body">
          <button className="composer-prompt" onClick={() => openCreator('post')} type="button">
            {isAuthenticated ? `Que estas pensando, ${promptName}?` : 'Inicia sesion para crear contenido'}
          </button>

          <div className="composer-quick-actions" aria-label="Accesos directos de creacion">
            <button className="composer-quick-btn story" onClick={() => openCreator('story')} title="Crear historia" type="button">
              ◉
            </button>
            <button className="composer-quick-btn post" onClick={() => openCreator('post')} title="Crear publicacion" type="button">
              ▣
            </button>
            <button className="composer-quick-btn live" onClick={() => openCreator('live')} title="Crear en vivo" type="button">
              ●
            </button>
          </div>
        </div>
      </section>

      {composerStatus ? <p className="composer-feedback success">{composerStatus}</p> : null}
      {composerError ? <p className="composer-feedback error">{composerError}</p> : null}
      {!isAuthenticated ? (
        <p className="composer-feedback">
          Para crear contenido desde Inicio, entra con tu cuenta. <Link to="/acceso">Ir a acceso</Link>
        </p>
      ) : null}

      {isPostComposerOpen ? (
        <PostComposer
          user={user}
          onClose={() => setIsPostComposerOpen(false)}
          onCreated={(post) => {
            onPostCreated?.(post)
            setComposerStatus('Publicación creada correctamente.')
          }}
        />
      ) : null}

      {isStoryStudioOpen ? (
        <StoryStudio
          user={user}
          mode="story"
          onClose={() => setIsStoryStudioOpen(false)}
          onPublish={publishStoryFromStudio}
        />
      ) : null}

      {isLiveStudioOpen ? (
        <div className="story-studio-backdrop" role="dialog" aria-modal="true" aria-label="Estudio de en vivo">
          <div className="story-studio live-studio">
            <aside className="story-studio-rail">
              <header className="story-studio-rail-head">
                <button className="story-studio-back" onClick={closeLiveStudio} type="button">‹ Cerrar</button>
                <h2>En vivo</h2>
              </header>

              <div className="story-studio-user">
                <span className="story-studio-avatar">
                  {user?.avatarUrl ? <img alt="" src={user.avatarUrl} /> : avatarText}
                </span>
                <b>{user?.displayName || user?.username || 'Tú'}</b>
              </div>

              <div className="story-studio-panel">
                {isLiveActive ? (
                  <div className="live-active-box">
                    <span className="live-badge">● EN VIVO</span>
                    <p className="live-active-title">{liveDraft.title || 'Transmisión'}</p>
                    <p className="live-active-viewers">
                      <b>{liveViewerCount}</b> {liveViewerCount === 1 ? 'espectador' : 'espectadores'} en tiempo real
                    </p>
                    <Link className="story-btn subtle" to={liveSharePath}>Abrir sala para compartir</Link>
                  </div>
                ) : (
                  <>
                    <label className="story-field">
                      Título del en vivo
                      <input
                        maxLength={120}
                        onChange={(event) => updateLiveDraft({ title: event.target.value })}
                        placeholder="Ej: Reporte en directo desde mi comunidad"
                        type="text"
                        value={liveDraft.title}
                      />
                    </label>

                    <label className="story-field">
                      Descripción
                      <textarea
                        maxLength={280}
                        onChange={(event) => updateLiveDraft({ description: event.target.value })}
                        placeholder="Explica brevemente qué vas a transmitir"
                        value={liveDraft.description}
                      />
                    </label>

                    <label className="story-studio-switch">
                      <input
                        checked={liveDraft.includeAudio}
                        disabled={isLivePreparing || isLiveStarting}
                        onChange={(event) => updateLiveDraft({ includeAudio: event.target.checked })}
                        type="checkbox"
                      />
                      Incluir micrófono
                    </label>

                    <label className="story-studio-switch">
                      <input
                        checked={liveDraft.acceptedTerms}
                        onChange={(event) => updateLiveDraft({ acceptedTerms: event.target.checked })}
                        type="checkbox"
                      />
                      Acepto las condiciones para usar cámara y micrófono.
                    </label>

                    <button
                      className="story-btn subtle"
                      disabled={isLivePreparing || isLiveStarting}
                      onClick={onPrepareLiveCamera}
                      type="button"
                    >
                      {isLivePreparing ? 'Solicitando permisos...' : isLiveStreamReady ? '↻ Reconfigurar cámara' : '📷 Configurar cámara'}
                    </button>
                  </>
                )}

                {liveStatus ? <p className="story-hint">{liveStatus}</p> : null}
              </div>

              {liveError ? <p className="story-studio-error">{liveError}</p> : null}

              <footer className="story-studio-foot">
                {isLiveActive ? (
                  <button
                    className="story-btn primary live-end"
                    disabled={isLiveStopping}
                    onClick={() => void onStopLiveBroadcast()}
                    type="button"
                  >
                    {isLiveStopping ? 'Finalizando...' : 'Finalizar transmisión'}
                  </button>
                ) : (
                  <>
                    <button className="story-btn ghost" onClick={closeLiveStudio} type="button">Cancelar</button>
                    <button
                      className="story-btn primary live-start"
                      disabled={isLiveStarting || isLivePreparing || !isLiveStreamReady}
                      onClick={onStartLiveBroadcast}
                      type="button"
                    >
                      {isLiveStarting ? 'Iniciando...' : '● Iniciar en vivo'}
                    </button>
                  </>
                )}
              </footer>
            </aside>

            <section className="story-studio-preview">
              <span className="story-studio-preview-label">Vista previa</span>
              <div className="story-stage-wrap">
                <div className={`story-stage live-stage ${isLiveStreamReady ? 'on' : ''}`}>
                  <video autoPlay className="story-stage-media" muted playsInline ref={livePreviewVideoRef} />
                  {!isLiveStreamReady ? (
                    <div className="live-stage-empty">
                      <span>📹</span>
                      Configura la cámara para ver la vista previa
                    </div>
                  ) : null}
                  {isLiveActive ? (
                    <span className="live-stage-badge">● EN VIVO · {liveViewerCount}</span>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </>
  )
}

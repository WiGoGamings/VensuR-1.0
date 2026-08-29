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
import { createPost } from '../../services/postsApi'
import { createStory } from '../../services/storiesApi'
import StoryStudio from '../composer/StoryStudio'

const LIVE_STUN_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}
const LIVE_OFFERS_POLL_INTERVAL_MS = 1100
const ICE_GATHERING_TIMEOUT_MS = 3500

function isImageFile(file) {
  const type = typeof file?.type === 'string' ? file.type : ''
  if (type.startsWith('image/')) return true
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i.test(file?.name || '')
}

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

/**
 * @param {{
 * isAuthenticated: boolean,
 * onPostCreated?: (post: import('../../data/feedData').Post) => void
 * }} props
 */
export default function Composer({ isAuthenticated, onPostCreated }) {
  const { user } = useAuth()
  const [composerType, setComposerType] = useState('')
  const [isComposerModalOpen, setIsComposerModalOpen] = useState(false)
  const [isStoryStudioOpen, setIsStoryStudioOpen] = useState(false)
  const [postEditorFile, setPostEditorFile] = useState(null)

  const [postDraft, setPostDraft] = useState('')
  const [postFile, setPostFile] = useState(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [composerError, setComposerError] = useState('')
  const [composerStatus, setComposerStatus] = useState('')

  const cameraVideoRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const [cameraTarget, setCameraTarget] = useState('')
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false)
  const [cameraConsentAccepted, setCameraConsentAccepted] = useState(false)
  const [isCameraPermissionBusy, setIsCameraPermissionBusy] = useState(false)
  const [cameraCapturedFile, setCameraCapturedFile] = useState(null)
  const [cameraCapturedUrl, setCameraCapturedUrl] = useState('')
  const [cameraHint, setCameraHint] = useState('')
  const [cameraError, setCameraError] = useState('')
  const [isCameraStreamReady, setIsCameraStreamReady] = useState(false)

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
  const [liveStatus, setLiveStatus] = useState('Configura el en vivo desde esta misma pestana.')
  const [liveError, setLiveError] = useState('')
  const [liveSharePath, setLiveSharePath] = useState('/vivo')

  const avatarText = useMemo(() => {
    const source = user?.displayName || user?.username || 'VR'
    return source.slice(0, 2).toUpperCase()
  }, [user?.displayName, user?.username])

  const promptName = useMemo(() => {
    const source = user?.displayName || user?.username || ''
    if (!source) return 'Comunidad'

    const firstName = source.trim().split(/\s+/)[0] || source
    return firstName.slice(0, 18)
  }, [user?.displayName, user?.username])

  useEffect(() => {
    return () => {
      if (cameraCapturedUrl) {
        URL.revokeObjectURL(cameraCapturedUrl)
      }
    }
  }, [cameraCapturedUrl])

  useEffect(() => {
      const livePreviewVideoNode = livePreviewVideoRef.current
      const livePeerConnections = livePeerByViewerIdRef.current
      const processingViewerOfferIds = processingViewerOfferIdsRef.current

    return () => {
      const cameraStream = cameraStreamRef.current
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop())
        cameraStreamRef.current = null
      }

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

  const stopCameraStream = () => {
    const stream = cameraStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }

    setIsCameraStreamReady(false)

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null
    }
  }

  const clearCameraCapture = () => {
    if (cameraCapturedUrl) {
      URL.revokeObjectURL(cameraCapturedUrl)
    }

    setCameraCapturedUrl('')
    setCameraCapturedFile(null)
  }

  const closeCameraModal = () => {
    stopCameraStream()
    clearCameraCapture()
    setIsCameraStreamReady(false)
    setCameraTarget('')
    setCameraConsentAccepted(false)
    setIsCameraPermissionBusy(false)
    setCameraHint('')
    setCameraError('')
    setIsCameraModalOpen(false)
  }

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
    statusMessage = 'Transmision en vivo detenida.',
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
    setLiveStatus('Configura el en vivo desde esta misma pestana.')
    setLiveSharePath('/vivo')

    if (clearDraft) {
      setLiveDraft({
        title: '',
        description: '',
        includeAudio: true,
        acceptedTerms: false,
      })
    }
  }

  const closeComposerModal = () => {
    if (composerType === 'live' && isLiveActive) {
      setLiveError('Primero debes detener el en vivo para cerrar este panel.')
      return
    }

    if (composerType === 'live') {
      resetLiveStudioState()
    }

    setIsComposerModalOpen(false)
    setComposerType('')
    setComposerError('')
  }

  const onSelectComposerType = (type) => {
    if (!isAuthenticated) {
      setComposerError('Debes iniciar sesion para crear historia, publicacion o en vivo desde Inicio.')
      return
    }

    setComposerError('')
    setComposerStatus('')

    if (type === 'story') {
      setIsStoryStudioOpen(true)
      return
    }

    setComposerType(type)
    setIsComposerModalOpen(true)

    if (type === 'live') {
      resetLiveStudioState()
    }
  }

  const onOpenCameraCapture = (targetType) => {
    stopCameraStream()
    clearCameraCapture()
    setIsCameraStreamReady(false)
    setCameraTarget(targetType)
    setCameraConsentAccepted(false)
    setIsCameraPermissionBusy(false)
    setCameraError('')
    setCameraHint('Acepta las condiciones y luego permite la camara para continuar.')
    setIsCameraModalOpen(true)
  }

  const onRequestCameraAccess = async () => {
    if (!cameraConsentAccepted) {
      setCameraError('Debes aceptar las condiciones para usar la camara.')
      return
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Tu navegador no permite usar camara en este dispositivo.')
      return
    }

    setIsCameraPermissionBusy(true)
    setCameraError('')
    setCameraHint('Google Chrome te pedira permiso para usar la camara del dispositivo.')

    try {
      stopCameraStream()

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })

      cameraStreamRef.current = stream

      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream

        try {
          await cameraVideoRef.current.play()
        } catch {
          // Algunos navegadores esperan gesto del usuario para iniciar la vista previa.
        }
      }

      setIsCameraStreamReady(true)
      setCameraHint('Permiso concedido. Enfoca y pulsa "Capturar foto".')
    } catch (error) {
      const messageByCode = {
        NotAllowedError: 'Permiso denegado. Debes permitir la camara para tomar la foto.',
        NotFoundError: 'No se detecto una camara disponible en este dispositivo.',
        NotReadableError: 'La camara esta siendo usada por otra aplicacion.',
      }

      const errorName = error && typeof error === 'object' ? error.name : ''
      setIsCameraStreamReady(false)
      setCameraError(messageByCode[errorName] || 'No se pudo abrir la camara del dispositivo.')
      setCameraHint('')
    } finally {
      setIsCameraPermissionBusy(false)
    }
  }

  const onCaptureCameraPhoto = () => {
    const videoElement = cameraVideoRef.current
    if (!videoElement) {
      setCameraError('La camara no esta lista todavia. Intenta nuevamente.')
      return
    }

    const width = Number(videoElement.videoWidth)
    const height = Number(videoElement.videoHeight)

    if (!width || !height) {
      setCameraError('Aun no hay vista previa de camara. Espera un momento e intenta otra vez.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      setCameraError('No se pudo preparar la captura de foto en este dispositivo.')
      return
    }

    context.drawImage(videoElement, 0, 0, width, height)

    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError('No se pudo generar la foto. Intenta de nuevo.')
        return
      }

      if (cameraCapturedUrl) {
        URL.revokeObjectURL(cameraCapturedUrl)
      }

      const file = new File([blob], `captura-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const previewUrl = URL.createObjectURL(blob)

      setCameraCapturedFile(file)
      setCameraCapturedUrl(previewUrl)
      setCameraError('')
      setCameraHint('Foto tomada. Ahora puedes Guardar foto y subir o Volver a intentarlo.')
    }, 'image/jpeg', 0.92)
  }

  const onRetryCameraPhoto = () => {
    clearCameraCapture()
    setCameraError('')
    setCameraHint('Toma una nueva foto desde la camara.')
  }

  const onSaveCameraPhoto = () => {
    if (!cameraCapturedFile) {
      setCameraError('Primero debes tomar una foto antes de guardarla.')
      return
    }

    setPostFile(cameraCapturedFile)
    setComposerError('')
    setComposerStatus('Foto guardada y lista para subir.')
    closeCameraModal()
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

  const publishEditedPostPhoto = async ({ mediaFile }) => {
    if (!mediaFile) return false
    setPostFile(mediaFile)
    setPostEditorFile(null)
    setComposerStatus('Foto editada y lista para publicar.')
    return true
  }

  const onPostSubmit = async (event) => {
    event.preventDefault()

    const caption = postDraft.trim()
    if (!caption && !postFile) {
      setComposerError('Escribe un texto o adjunta un archivo para publicar.')
      return
    }

    setIsSubmitting(true)
    setComposerError('')

    try {
      const created = await createPost({
        caption,
        mediaFile: postFile,
        alsoStory: false,
      })

      onPostCreated?.(created)
      setPostDraft('')
      setPostFile(null)
      setComposerStatus('Publicacion creada desde Inicio correctamente.')
      closeComposerModal()
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : 'No se pudo crear la publicacion.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const onPrepareLiveCamera = async () => {
    if (!liveDraft.acceptedTerms) {
      setLiveError('Debes aceptar las condiciones para iniciar camara y microfono.')
      return
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setLiveError('Tu navegador no permite iniciar camara para en vivo.')
      return
    }

    setIsLivePreparing(true)
    setLiveError('')
    setLiveStatus('Solicitando permisos de camara y microfono en Google Chrome...')

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
      setLiveStatus('Camara lista. Pulsa Iniciar en vivo para transmitir en tiempo real.')
    } catch (error) {
      const messageByCode = {
        NotAllowedError: 'Permiso denegado. Debes permitir camara y microfono para en vivo.',
        NotFoundError: 'No se detecto camara o microfono disponible.',
        NotReadableError: 'Camara o microfono esta siendo usado por otra aplicacion.',
      }

      const errorName = error && typeof error === 'object' ? error.name : ''
      setLiveError(messageByCode[errorName] || 'No se pudo iniciar camara para en vivo.')
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
            statusMessage: 'La transmision finalizo.',
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
      setLiveError('Agrega un titulo para iniciar el en vivo.')
      return
    }

    if (!isLiveStreamReady || !liveBroadcastStreamRef.current) {
      setLiveError('Primero configura camara y permisos antes de iniciar en vivo.')
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
    const hasPreview = isLiveStreamReady

    if (!isLiveActive) {
      if (hasPreview) {
        stopLivePreviewStream()
      }

      setLiveStatus('Vista previa detenida.')
      return
    }

    await stopLiveBroadcastSession({
      notifyServer: true,
      statusMessage: 'Transmision detenida correctamente.',
    })
  }

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
          <button
            className="composer-prompt"
            onClick={() => onSelectComposerType('post')}
            type="button"
          >
            {isAuthenticated
              ? `Que estas pensando, ${promptName}?`
              : 'Inicia sesion para crear contenido'}
          </button>

          <div className="composer-quick-actions" aria-label="Accesos directos de creacion">
            <button
              className="composer-quick-btn story"
              onClick={() => onSelectComposerType('story')}
              title="Crear historia"
              type="button"
            >
              ◉
            </button>
            <button
              className="composer-quick-btn post"
              onClick={() => onSelectComposerType('post')}
              title="Crear publicacion"
              type="button"
            >
              ▣
            </button>
            <button
              className="composer-quick-btn live"
              onClick={() => onSelectComposerType('live')}
              title="Crear en vivo"
              type="button"
            >
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

      {isComposerModalOpen ? (
        <section
          className="composer-create-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeComposerModal()
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Crear contenido desde inicio"
        >
          <article className="composer-create-modal panel">
            <header className="composer-create-head">
              <h2>{composerType === 'live' ? 'Configurar en vivo' : 'Crear publicacion'}</h2>
              <button className="composer-create-close" onClick={closeComposerModal} type="button">
                Cerrar
              </button>
            </header>


            {composerType === 'post' ? (
              <form className="composer-create-form" onSubmit={onPostSubmit}>
                <label>
                  Texto de publicacion
                  <textarea
                    onChange={(event) => setPostDraft(event.target.value)}
                    placeholder="Comparte tu reporte o contexto"
                    value={postDraft}
                  />
                </label>

                <label className="composer-create-file">
                  Adjuntar desde galeria (imagen, video o audio)
                  <input
                    accept="image/*,video/*,audio/*"
                    onChange={(event) => setPostFile(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>

                <button className="composer-camera-btn" onClick={() => onOpenCameraCapture('post')} type="button">
                  Tomar foto desde el dispositivo
                </button>

                {postFile ? (
                  <div className="composer-file-row">
                    <p className="composer-file-name">Archivo: {postFile.name}</p>
                    {isImageFile(postFile) ? (
                      <button
                        className="composer-edit-photo-btn"
                        onClick={() => setPostEditorFile(postFile)}
                        type="button"
                      >
                        ✨ Editar foto (filtros, texto)
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <button className="composer-submit" disabled={isSubmitting} type="submit">
                  {isSubmitting ? 'Publicando...' : 'Publicar publicacion'}
                </button>
              </form>
            ) : null}

            {composerType === 'live' ? (
              <form className="composer-create-form composer-live-form" onSubmit={onStartLiveBroadcast}>
                <label>
                  Titulo del en vivo
                  <input
                    onChange={(event) =>
                      setLiveDraft((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="Ej: Reporte en directo desde mi comunidad"
                    value={liveDraft.title}
                  />
                </label>

                <label>
                  Descripcion del en vivo
                  <textarea
                    onChange={(event) =>
                      setLiveDraft((current) => ({ ...current, description: event.target.value }))
                    }
                    placeholder="Explica brevemente que vas a transmitir"
                    value={liveDraft.description}
                  />
                </label>

                <label className="composer-live-switch">
                  <input
                    checked={liveDraft.includeAudio}
                    disabled={isLiveActive || isLivePreparing || isLiveStarting}
                    onChange={(event) =>
                      setLiveDraft((current) => ({
                        ...current,
                        includeAudio: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Incluir microfono en la transmision
                </label>

                <label className="composer-live-switch">
                  <input
                    checked={liveDraft.acceptedTerms}
                    disabled={isLiveActive}
                    onChange={(event) =>
                      setLiveDraft((current) => ({
                        ...current,
                        acceptedTerms: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  Acepto condiciones y permisos para usar camara y microfono.
                </label>

                <div className={`composer-live-preview ${isLiveStreamReady ? 'on' : ''}`}>
                  <video autoPlay className="composer-live-video" muted playsInline ref={livePreviewVideoRef} />
                  {!isLiveStreamReady ? <p>Pulsa "Configurar camara" para ver la vista previa.</p> : null}
                </div>

                {liveStatus ? <p className="composer-feedback success">{liveStatus}</p> : null}
                {liveError ? <p className="composer-feedback error">{liveError}</p> : null}

                <div className="composer-live-actions">
                  <button
                    className="composer-live-btn"
                    disabled={isLivePreparing || isLiveStarting || isLiveActive}
                    onClick={onPrepareLiveCamera}
                    type="button"
                  >
                    {isLivePreparing ? 'Solicitando permisos...' : 'Configurar camara'}
                  </button>

                  <button
                    className="composer-live-btn live-start"
                    disabled={isLiveStarting || isLivePreparing || isLiveStopping || isLiveActive || !isLiveStreamReady}
                    type="submit"
                  >
                    {isLiveStarting ? 'Iniciando en vivo...' : 'Iniciar en vivo'}
                  </button>

                  <button
                    className="composer-live-btn live-stop"
                    disabled={isLiveStopping || (!isLiveActive && !isLiveStreamReady)}
                    onClick={() => {
                      void onStopLiveBroadcast()
                    }}
                    type="button"
                  >
                    {isLiveStopping ? 'Deteniendo...' : 'Detener en vivo'}
                  </button>
                </div>

                <p className="composer-live-count">
                  Espectadores en tiempo real: <b>{liveViewerCount}</b>
                </p>

                {isLiveActive ? (
                  <p className="composer-feedback">
                    Comparte con tus seguidores esta sala: <Link to={liveSharePath}>Abrir sala en vivo</Link>
                  </p>
                ) : null}
              </form>
            ) : null}
          </article>
        </section>
      ) : null}

      {isCameraModalOpen ? (
        <section
          className="composer-camera-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeCameraModal()
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Tomar foto desde el dispositivo"
        >
          <article className="composer-camera-modal panel">
            <header className="composer-camera-head">
              <h2>Tomar foto para {cameraTarget === 'story' ? 'historia' : 'publicacion'}</h2>
              <button className="composer-camera-close" onClick={closeCameraModal} type="button">
                Cerrar
              </button>
            </header>

            <p className="composer-camera-note">
              Para continuar, debes aceptar las condiciones. Luego Google Chrome pedira tu permiso para usar la camara.
            </p>

            <label className="composer-camera-consent">
              <input
                checked={cameraConsentAccepted}
                onChange={(event) => setCameraConsentAccepted(event.target.checked)}
                type="checkbox"
              />
              Acepto usar mi camara para capturar contenido y subirlo en VensuR.
            </label>

            <div className="composer-camera-controls">
              <button
                className="composer-submit"
                disabled={!cameraConsentAccepted || isCameraPermissionBusy}
                onClick={onRequestCameraAccess}
                type="button"
              >
                {isCameraPermissionBusy ? 'Solicitando permiso...' : 'Aceptar condiciones y abrir camara'}
              </button>
              <button
                className="composer-submit secondary"
                disabled={!isCameraStreamReady}
                onClick={onCaptureCameraPhoto}
                type="button"
              >
                Capturar foto
              </button>
            </div>

            <div className="composer-camera-preview" aria-label="Vista previa de camara">
              {cameraCapturedUrl ? (
                <img alt="Foto capturada" className="composer-camera-image" src={cameraCapturedUrl} />
              ) : (
                <video autoPlay className="composer-camera-video" muted playsInline ref={cameraVideoRef} />
              )}
            </div>

            {cameraHint ? <p className="composer-feedback success">{cameraHint}</p> : null}
            {cameraError ? <p className="composer-feedback error">{cameraError}</p> : null}

            {cameraCapturedFile ? (
              <div className="composer-camera-actions">
                <button className="composer-submit" onClick={onSaveCameraPhoto} type="button">
                  Guardar foto y subir
                </button>
                <button className="composer-submit secondary" onClick={onRetryCameraPhoto} type="button">
                  Volver a intentarlo
                </button>
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {isStoryStudioOpen ? (
        <StoryStudio
          user={user}
          mode="story"
          onClose={() => setIsStoryStudioOpen(false)}
          onPublish={publishStoryFromStudio}
        />
      ) : null}

      {postEditorFile ? (
        <StoryStudio
          user={user}
          mode="post"
          initialFile={postEditorFile}
          onClose={() => setPostEditorFile(null)}
          onPublish={publishEditedPostPhoto}
        />
      ) : null}
    </>
  )
}

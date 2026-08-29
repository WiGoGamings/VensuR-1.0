import './StoryStudio.css'
import './PostComposer.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPost } from '../../services/postsApi'
import { blobToFile } from './storyAssets'
import StoryStudio from './StoryStudio'

function initialsOf(user) {
  const source = user?.displayName || user?.username || 'VR'
  return source.slice(0, 2).toUpperCase()
}

function fileKind(file) {
  const type = typeof file?.type === 'string' ? file.type : ''
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'image'
}

/**
 * Estudio de creación de publicaciones, con la misma estética que el de historias.
 * @param {{
 *  user: any,
 *  onClose: () => void,
 *  onCreated?: (post: any) => void,
 * }} props
 */
export default function PostComposer({ user, onClose, onCreated }) {
  const [caption, setCaption] = useState('')
  const [location, setLocation] = useState('')
  const [alsoStory, setAlsoStory] = useState(false)
  const [mediaFile, setMediaFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const previewUrlRef = useRef('')
  const fileInputRef = useRef(null)

  const [showPhotoEditor, setShowPhotoEditor] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Cámara integrada.
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraReady, setIsCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const cameraVideoRef = useRef(null)
  const cameraStreamRef = useRef(null)

  const kind = mediaFile ? fileKind(mediaFile) : ''

  const setMedia = useCallback((file) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
    }
    setMediaFile(file)
    if (!file) {
      setPreviewUrl('')
      setAlsoStory(false)
      return
    }
    const url = URL.createObjectURL(file)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }, [])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    cameraStreamRef.current = null
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null
    setIsCameraReady(false)
  }, [])

  const openCamera = async () => {
    setCameraError('')
    setIsCameraOpen(true)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Tu navegador no permite usar la cámara.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      cameraStreamRef.current = stream
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream
        await cameraVideoRef.current.play().catch(() => {})
      }
      setIsCameraReady(true)
    } catch {
      setCameraError('No se pudo abrir la cámara. Revisa los permisos.')
    }
  }

  const closeCamera = () => {
    stopCamera()
    setIsCameraOpen(false)
    setCameraError('')
  }

  const capturePhoto = () => {
    const video = cameraVideoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        setMedia(blobToFile(blob, `captura-${Date.now()}.jpg`))
        closeCamera()
      },
      'image/jpeg',
      0.92,
    )
  }

  const submit = async () => {
    if (isSubmitting) return
    const text = caption.trim()
    if (!text && !mediaFile) {
      setError('Escribe algo o agrega una foto/video para publicar.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      const post = await createPost({
        caption: text,
        mediaFile,
        alsoStory: Boolean(alsoStory && mediaFile && kind !== 'audio'),
        location: location.trim(),
      })
      onCreated?.(post)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo publicar. Intenta de nuevo.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (showPhotoEditor && mediaFile && kind === 'image') {
    return (
      <StoryStudio
        user={user}
        mode="post"
        initialFile={mediaFile}
        onClose={() => setShowPhotoEditor(false)}
        onPublish={async ({ mediaFile: edited }) => {
          if (edited) setMedia(edited)
          setShowPhotoEditor(false)
          return true
        }}
      />
    )
  }

  return (
    <div className="story-studio-backdrop" role="dialog" aria-modal="true" aria-label="Crear publicación">
      <div className="story-studio">
        <aside className="story-studio-rail">
          <header className="story-studio-rail-head">
            <button className="story-studio-back" onClick={onClose} type="button">‹ Cerrar</button>
            <h2>Crear publicación</h2>
          </header>

          <div className="story-studio-user">
            <span className="story-studio-avatar">
              {user?.avatarUrl ? <img alt="" src={user.avatarUrl} /> : initialsOf(user)}
            </span>
            <b>{user?.displayName || user?.username || 'Tú'}</b>
          </div>

          <div className="story-studio-panel">
            <label className="story-field">
              ¿Qué quieres reportar o compartir?
              <textarea
                autoFocus
                maxLength={2000}
                onChange={(event) => setCaption(event.target.value)}
                placeholder="Escribe tu publicación..."
                rows={5}
                value={caption}
              />
            </label>

            <label className="story-field">
              Ubicación (opcional)
              <input
                maxLength={80}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Ej: Caracas, La Candelaria"
                type="text"
                value={location}
              />
            </label>

            <div className="pc-media-actions">
              <button className="story-btn subtle" onClick={() => fileInputRef.current?.click()} type="button">
                🖼️ Galería
              </button>
              <button className="story-btn subtle" onClick={openCamera} type="button">
                📷 Cámara
              </button>
              {mediaFile && kind === 'image' ? (
                <button className="story-btn subtle" onClick={() => setShowPhotoEditor(true)} type="button">
                  ✨ Editar foto
                </button>
              ) : null}
              {mediaFile ? (
                <button className="story-btn ghost danger" onClick={() => setMedia(null)} type="button">
                  Quitar
                </button>
              ) : null}
            </div>

            {mediaFile && kind !== 'audio' ? (
              <label className="story-studio-switch pc-switch">
                <input checked={alsoStory} onChange={(event) => setAlsoStory(event.target.checked)} type="checkbox" />
                Compartir también como historia (24 h)
              </label>
            ) : null}

            <input
              accept="image/*,video/*,audio/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) setMedia(file)
              }}
              ref={fileInputRef}
              type="file"
            />
          </div>

          {error ? <p className="story-studio-error">{error}</p> : null}

          <footer className="story-studio-foot">
            <button className="story-btn ghost" onClick={onClose} type="button">Descartar</button>
            <button className="story-btn primary" disabled={isSubmitting} onClick={submit} type="button">
              {isSubmitting ? 'Publicando...' : 'Publicar'}
            </button>
          </footer>
        </aside>

        <section className="story-studio-preview">
          <span className="story-studio-preview-label">Vista previa</span>
          <div className="pc-preview-wrap">
            <div className="pc-card">
              <div className="pc-card-head">
                <span className="story-studio-avatar sm">
                  {user?.avatarUrl ? <img alt="" src={user.avatarUrl} /> : initialsOf(user)}
                </span>
                <div>
                  <b>{user?.displayName || user?.username || 'Tú'}</b>
                  <small>{location.trim() ? `📍 ${location.trim()}` : 'Ahora · Venezuela'}</small>
                </div>
              </div>

              {caption.trim() ? <p className="pc-card-caption">{caption}</p> : null}

              {isCameraOpen ? (
                <div className="pc-card-media camera">
                  <video autoPlay className="pc-media" muted playsInline ref={cameraVideoRef} />
                  <div className="pc-camera-bar">
                    {cameraError ? <span className="pc-camera-error">{cameraError}</span> : null}
                    <button className="story-btn subtle" onClick={closeCamera} type="button">Cancelar</button>
                    <button className="story-btn primary" disabled={!isCameraReady} onClick={capturePhoto} type="button">
                      Capturar
                    </button>
                  </div>
                </div>
              ) : previewUrl ? (
                <div className="pc-card-media">
                  {kind === 'video' ? (
                    <video autoPlay className="pc-media" controls loop muted playsInline src={previewUrl} />
                  ) : kind === 'audio' ? (
                    <div className="pc-audio">
                      <span>🎵 {mediaFile.name}</span>
                      <audio controls src={previewUrl} />
                    </div>
                  ) : (
                    <img alt="" className="pc-media" src={previewUrl} />
                  )}
                </div>
              ) : (
                <button className="pc-dropzone" onClick={() => fileInputRef.current?.click()} type="button">
                  <span className="pc-dropzone-icon">＋</span>
                  Agrega una foto o video
                  <small>o solo texto, como en Facebook</small>
                </button>
              )}

              <div className="pc-card-foot">
                <span>❤ Reacciones</span>
                <span>💬 Comentarios</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

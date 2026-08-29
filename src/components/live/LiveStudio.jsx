import '../composer/StoryStudio.css'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useLiveBroadcast } from '../../contexts/LiveBroadcastContext'

function initialsOf(user) {
  const source = user?.displayName || user?.username || 'VR'
  return source.slice(0, 2).toUpperCase()
}

/** Se monta fresco cada vez que se abre el estudio (LiveOverlays lo condiciona). */
export default function LiveStudio() {
  const { user } = useAuth()
  const {
    stream,
    isCameraReady,
    includeAudio,
    isPreparing,
    isStarting,
    status,
    error,
    setIncludeAudio,
    prepareCamera,
    startBroadcast,
    closeStudio,
  } = useLiveBroadcast()

  const videoRef = useRef(null)
  const [draft, setDraft] = useState({ title: '', description: '', acceptedTerms: false })

  useEffect(() => {
    const node = videoRef.current
    if (node && node.srcObject !== stream) {
      node.srcObject = stream || null
      if (stream) node.play?.().catch(() => {})
    }
  }, [stream])

  const onConfigureCamera = () => {
    if (!draft.acceptedTerms) {
      return
    }
    void prepareCamera({ includeAudio })
  }

  const onStart = async () => {
    await startBroadcast({ title: draft.title, description: draft.description })
  }

  return (
    <div className="story-studio-backdrop" role="dialog" aria-modal="true" aria-label="Estudio de en vivo">
      <div className="story-studio live-studio">
        <aside className="story-studio-rail">
          <header className="story-studio-rail-head">
            <button className="story-studio-back" onClick={closeStudio} type="button">‹ Cerrar</button>
            <h2>En vivo</h2>
          </header>

          <div className="story-studio-user">
            <span className="story-studio-avatar">
              {user?.avatarUrl ? <img alt="" src={user.avatarUrl} /> : initialsOf(user)}
            </span>
            <b>{user?.displayName || user?.username || 'Tú'}</b>
          </div>

          <div className="story-studio-panel">
            <label className="story-field">
              Título del en vivo
              <input
                maxLength={120}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Ej: Reporte en directo desde mi comunidad"
                type="text"
                value={draft.title}
              />
            </label>

            <label className="story-field">
              Descripción
              <textarea
                maxLength={280}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Explica brevemente qué vas a transmitir"
                value={draft.description}
              />
            </label>

            <label className="story-studio-switch">
              <input
                checked={includeAudio}
                disabled={isPreparing || isCameraReady}
                onChange={(event) => setIncludeAudio(event.target.checked)}
                type="checkbox"
              />
              Incluir micrófono
            </label>

            <label className="story-studio-switch">
              <input
                checked={draft.acceptedTerms}
                onChange={(event) => setDraft((current) => ({ ...current, acceptedTerms: event.target.checked }))}
                type="checkbox"
              />
              Acepto las condiciones para usar cámara y micrófono.
            </label>

            <button
              className="story-btn subtle"
              disabled={!draft.acceptedTerms || isPreparing || isStarting}
              onClick={onConfigureCamera}
              type="button"
            >
              {isPreparing
                ? 'Solicitando permisos...'
                : isCameraReady
                  ? '↻ Reconfigurar cámara'
                  : '📷 Configurar cámara'}
            </button>

            <p className="story-hint">
              Al iniciar, tu en vivo seguirá activo aunque cierres este panel. Solo se detiene cuando
              pulses <b>Parar transmisión</b>.
            </p>

            {status ? <p className="story-hint">{status}</p> : null}
          </div>

          {error ? <p className="story-studio-error">{error}</p> : null}

          <footer className="story-studio-foot">
            <button className="story-btn ghost" onClick={closeStudio} type="button">Cancelar</button>
            <button
              className="story-btn primary live-start"
              disabled={isStarting || isPreparing || !isCameraReady}
              onClick={onStart}
              type="button"
            >
              {isStarting ? 'Iniciando...' : '● Iniciar en vivo'}
            </button>
          </footer>
        </aside>

        <section className="story-studio-preview">
          <span className="story-studio-preview-label">Vista previa</span>
          <div className="story-stage-wrap">
            <div className={`story-stage live-stage ${isCameraReady ? 'on' : ''}`}>
              <video autoPlay className="story-stage-media" muted playsInline ref={videoRef} />
              {!isCameraReady ? (
                <div className="live-stage-empty">
                  <span>📹</span>
                  Configura la cámara para ver la vista previa
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

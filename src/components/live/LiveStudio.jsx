import '../composer/StoryStudio.css'
import './LiveStudio.css'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useLiveBroadcast } from '../../contexts/LiveBroadcastContext'

function initialsOf(user) {
  const source = user?.displayName || user?.username || 'VR'
  return source.slice(0, 2).toUpperCase()
}

/** Barra de nivel del micrófono: confirma que el audio entra antes de salir en vivo. */
function MicLevelMeter({ stream }) {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    const audioTrack = stream?.getAudioTracks?.()[0]
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!audioTrack || !AudioCtx) return undefined

    const ctx = new AudioCtx()
    const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]))
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0

    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i += 1) {
        const v = Math.abs(data[i] - 128) / 128
        if (v > peak) peak = v
      }
      setLevel((prev) => prev * 0.7 + Math.min(1, peak * 1.6) * 0.3)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      source.disconnect()
      void ctx.close()
    }
  }, [stream])

  return (
    <div className="live-mic-meter" aria-hidden="true">
      <span className="live-mic-meter-icon">🎤</span>
      <span className="live-mic-meter-track">
        <span className="live-mic-meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </span>
    </div>
  )
}

/** Se monta fresco cada vez que se abre el estudio (LiveOverlays lo condiciona). */
export default function LiveStudio() {
  const { user } = useAuth()
  const {
    stream,
    isCameraReady,
    includeAudio,
    mediaInputs,
    selectedCameraId,
    selectedMicId,
    isPreparing,
    isStarting,
    status,
    error,
    setIncludeAudio,
    setSelectedCameraId,
    setSelectedMicId,
    refreshDeviceList,
    prepareCamera,
    startBroadcast,
    closeStudio,
  } = useLiveBroadcast()

  const videoRef = useRef(null)
  const [draft, setDraft] = useState({ title: '', description: '', acceptedTerms: false })

  useEffect(() => {
    void refreshDeviceList()
  }, [refreshDeviceList])

  useEffect(() => {
    const node = videoRef.current
    if (node && node.srcObject !== stream) {
      node.srcObject = stream || null
      if (stream) node.play?.().catch(() => {})
    }
  }, [stream])

  const onConfigureCamera = () => {
    if (!draft.acceptedTerms) return
    void prepareCamera({ includeAudio, cameraId: selectedCameraId, micId: selectedMicId })
  }

  const onChangeCamera = (deviceId) => {
    setSelectedCameraId(deviceId)
    if (isCameraReady) void prepareCamera({ includeAudio, cameraId: deviceId, micId: selectedMicId })
  }

  const onChangeMic = (deviceId) => {
    setSelectedMicId(deviceId)
    if (isCameraReady) void prepareCamera({ includeAudio: true, cameraId: selectedCameraId, micId: deviceId })
  }

  const onStart = async () => {
    await startBroadcast({ title: draft.title, description: draft.description })
  }

  const cameras = mediaInputs?.cameras || []
  const microphones = mediaInputs?.microphones || []

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

            <label className="story-field">
              Cámara
              <select
                disabled={isPreparing}
                onChange={(event) => onChangeCamera(event.target.value)}
                value={selectedCameraId}
              >
                {cameras.length === 0 ? <option value="">Cámara predeterminada</option> : null}
                {cameras.map((cam) => (
                  <option key={cam.deviceId || cam.label} value={cam.deviceId}>{cam.label}</option>
                ))}
              </select>
            </label>

            <label className="story-field">
              Micrófono
              <select
                disabled={isPreparing || !includeAudio}
                onChange={(event) => onChangeMic(event.target.value)}
                value={selectedMicId}
              >
                {microphones.length === 0 ? <option value="">Micrófono predeterminado</option> : null}
                {microphones.map((mic) => (
                  <option key={mic.deviceId || mic.label} value={mic.deviceId}>{mic.label}</option>
                ))}
              </select>
            </label>

            <label className="story-studio-switch">
              <input
                checked={includeAudio}
                disabled={isPreparing}
                onChange={(event) => {
                  setIncludeAudio(event.target.checked)
                  if (isCameraReady) {
                    void prepareCamera({
                      includeAudio: event.target.checked,
                      cameraId: selectedCameraId,
                      micId: selectedMicId,
                    })
                  }
                }}
                type="checkbox"
              />
              Transmitir con micrófono
            </label>

            {isCameraReady && includeAudio ? <MicLevelMeter stream={stream} /> : null}

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
                  ? '↻ Reconfigurar cámara y micrófono'
                  : '🎥 Configurar cámara y micrófono'}
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
                  Configura la cámara y el micrófono para ver la vista previa
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

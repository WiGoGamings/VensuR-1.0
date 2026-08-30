import './LiveOverlays.css'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatElapsed, useElapsed, useLiveBroadcast } from '../../contexts/LiveBroadcastContext'
import LiveStudio from './LiveStudio'

function SelfVideo({ stream, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    if (node && node.srcObject !== stream) {
      node.srcObject = stream || null
      if (stream) node.play?.().catch(() => {})
    }
  }, [stream])
  return <video autoPlay className={className} muted playsInline ref={ref} />
}

function LiveDock() {
  const { isLive, isMonitorOpen, stream, viewerCount, startedAt, openMonitor, stopBroadcast } = useLiveBroadcast()
  const elapsedSec = useElapsed(isLive && !isMonitorOpen ? startedAt : 0)
  if (!isLive || isMonitorOpen) return null

  return (
    <div className="live-dock" role="status" aria-label="Transmisión en vivo activa">
      <div className="live-dock-thumb">
        <SelfVideo stream={stream} className="live-dock-video" />
        <span className="live-dock-tag">● EN VIVO</span>
      </div>
      <div className="live-dock-info">
        <b>{viewerCount} {viewerCount === 1 ? 'viendo' : 'viendo'}</b>
        <small>{formatElapsed(elapsedSec)}</small>
      </div>
      <div className="live-dock-actions">
        <button className="live-dock-btn" onClick={openMonitor} type="button">Ver</button>
        <button className="live-dock-btn stop" onClick={() => void stopBroadcast()} type="button">Parar</button>
      </div>
    </div>
  )
}

function LiveMonitor() {
  const {
    isLive,
    isMonitorOpen,
    stream,
    meta,
    viewerCount,
    viewers,
    startedAt,
    sharePath,
    isStopping,
    error,
    recordingStatus,
    closeMonitor,
    stopBroadcast,
  } = useLiveBroadcast()
  const elapsedSec = useElapsed(isMonitorOpen && isLive ? startedAt : 0)
  const [copied, setCopied] = useState(false)

  if (!isMonitorOpen || !isLive) return null

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${sharePath}` : sharePath

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="live-monitor-backdrop" role="dialog" aria-modal="true" aria-label="Monitor de tu transmisión">
      <div className="live-monitor">
        <header className="live-monitor-head">
          <span className="live-monitor-tag">● EN VIVO</span>
          <h2>{meta.title || 'Tu transmisión'}</h2>
          <button className="live-monitor-min" onClick={closeMonitor} type="button">Minimizar ⌄</button>
        </header>

        <div className="live-monitor-body">
          <div className="live-monitor-stage">
            <SelfVideo stream={stream} className="live-monitor-video" />
            <span className="live-monitor-stage-badge">● EN VIVO · {formatElapsed(elapsedSec)}</span>
          </div>

          <aside className="live-monitor-side">
            <div className="live-monitor-stat">
              <b>{viewerCount}</b>
              <span>{viewerCount === 1 ? 'persona viendo' : 'personas viendo'}</span>
            </div>

            <div className="live-monitor-share">
              <span>Enlace para compartir</span>
              <div>
                <input readOnly value={shareUrl} />
                <button onClick={copyLink} type="button">{copied ? '¡Copiado!' : 'Copiar'}</button>
              </div>
              <Link className="live-monitor-open" to={sharePath} target="_blank" rel="noreferrer">
                Abrir la sala en otra pestaña ↗
              </Link>
            </div>

            <div className="live-monitor-viewers">
              <span>Espectadores conectados</span>
              {viewers.length ? (
                <ul>
                  {viewers.map((viewer) => (
                    <li key={viewer.viewerId}>
                      <span className="live-monitor-viewer-avatar">
                        {viewer.avatarUrl ? (
                          <img alt="" src={viewer.avatarUrl} />
                        ) : (
                          (viewer.displayName || 'E').slice(0, 1).toUpperCase()
                        )}
                      </span>
                      <span className="live-monitor-viewer-name">
                        {viewer.displayName}
                        {viewer.username ? <small>@{viewer.username}</small> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="live-monitor-empty">Aún nadie se ha conectado. Comparte el enlace.</p>
              )}
            </div>

            {recordingStatus === 'grabando' ? (
              <p className="live-monitor-rec">
                <i aria-hidden="true" /> Grabando · se guardará en tu perfil (Guardado) por 72 h
              </p>
            ) : recordingStatus === 'limite' ? (
              <p className="live-monitor-rec">Grabación al límite de tamaño: se guardará lo grabado hasta ahora.</p>
            ) : null}

            {error ? <p className="live-monitor-error">{error}</p> : null}
          </aside>
        </div>

        <footer className="live-monitor-foot">
          <button className="live-monitor-btn ghost" onClick={closeMonitor} type="button">
            Seguir viendo la app
          </button>
          <button
            className="live-monitor-btn stop"
            disabled={isStopping}
            onClick={() => void stopBroadcast()}
            type="button"
          >
            {isStopping ? 'Finalizando...' : 'Parar transmisión'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default function LiveOverlays() {
  const { isStudioOpen, isLive } = useLiveBroadcast()
  return (
    <>
      {isStudioOpen && !isLive ? <LiveStudio /> : null}
      <LiveDock />
      <LiveMonitor />
    </>
  )
}

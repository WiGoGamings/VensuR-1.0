import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import useLiveViewer from '../hooks/useLiveViewer'
import { getLiveRoom, sendLiveChatMessage, sendLiveLikes } from '../services/liveApi'
import './SalaEnVivo.css'

const ROOM_POLL_MS = 2500
const LIKE_FLUSH_MS = 850
const CHAT_MAX_LENGTH = 280

const EMOJIS = [
  '❤️', '🔥', '👏', '😂', '😍', '😮', '😢', '😡', '🙌', '💪',
  '🇻🇪', '✊', '🕊️', '⭐', '🎉', '👍', '👎', '🤝', '🙏', '💯',
  '😅', '🥺', '😎', '🤔', '👀', '💥', '📣', '⚡', '🌟', '❓',
]

function formatCount(value) {
  const n = Math.max(0, Math.round(Number(value) || 0))
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`.replace('.0k', 'k')
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0M', 'M')
}

function initialsOf(name) {
  const text = String(name || '').trim()
  if (!text) return 'VE'
  const parts = text.split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'VE'
}

export default function SalaEnVivoPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { isAuthenticated, user } = useAuth()

  const {
    videoRef,
    status,
    error: viewerError,
    isWatching,
    join,
    leave,
    viewerCount,
    ended,
    setViewerCount,
    setEnded,
  } = useLiveViewer()

  const [room, setRoom] = useState(null)
  const [roomError, setRoomError] = useState('')
  const [messages, setMessages] = useState([])
  const [likes, setLikes] = useState(0)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showEmojis, setShowEmojis] = useState(false)
  const [shareHint, setShareHint] = useState('')
  const [hearts, setHearts] = useState([])
  const [isMuted, setIsMuted] = useState(true)

  const lastSeqRef = useRef(0)
  const pendingLikesRef = useRef(0)
  const likeFlushTimerRef = useRef(null)
  const heartSeqRef = useRef(0)
  const chatScrollRef = useRef(null)

  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''

  // Conectar al directo al entrar.
  useEffect(() => {
    if (!sessionId || !isAuthenticated) return undefined
    void join(sessionId)
    return () => {
      void leave({ notifyServer: true })
    }
  }, [sessionId, isAuthenticated, join, leave])

  // Sondeo de la sala: chat + likes + espectadores.
  useEffect(() => {
    if (!sessionId || !isAuthenticated) return undefined
    let active = true

    const poll = async () => {
      try {
        const payload = await getLiveRoom(sessionId, lastSeqRef.current)
        if (!active) return

        setRoom(payload.session || null)
        setRoomError('')
        // Los likes solo crecen: nunca dejamos que el sondeo reduzca el contador
        // por debajo de lo que ya mostramos (evita saltos hacia atrás con la tanda local).
        if (Number.isFinite(Number(payload.likes))) {
          setLikes((current) => Math.max(current, Number(payload.likes)))
        }
        if (Number.isFinite(Number(payload.viewerCount))) setViewerCount(Math.max(0, Number(payload.viewerCount)))
        if (payload.ended) setEnded(true)

        const incoming = Array.isArray(payload.chat) ? payload.chat : []
        if (incoming.length) {
          lastSeqRef.current = Math.max(lastSeqRef.current, ...incoming.map((m) => Number(m.seq) || 0))
          setMessages((current) => {
            const seen = new Set(current.map((m) => m.id))
            const merged = [...current, ...incoming.filter((m) => !seen.has(m.id))]
            return merged.slice(-240)
          })
        } else if (Number.isFinite(Number(payload.latestSeq))) {
          lastSeqRef.current = Math.max(lastSeqRef.current, Number(payload.latestSeq))
        }
      } catch (pollError) {
        if (!active) return
        setRoomError(
          pollError instanceof Error ? pollError.message : 'No se pudo cargar la sala en vivo.',
        )
      }
    }

    void poll()
    const timerId = setInterval(poll, ROOM_POLL_MS)
    return () => {
      active = false
      clearInterval(timerId)
    }
  }, [sessionId, isAuthenticated, setEnded, setViewerCount])

  // Autoscroll del chat.
  useEffect(() => {
    const node = chatScrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])

  const flushLikes = useCallback(async () => {
    likeFlushTimerRef.current = null
    const count = pendingLikesRef.current
    pendingLikesRef.current = 0
    if (!count || !sessionId) return

    try {
      const payload = await sendLiveLikes(sessionId, count)
      if (Number.isFinite(Number(payload?.likes))) {
        setLikes((current) => Math.max(current, Number(payload.likes)))
      }
    } catch {
      // Se reintenta con el siguiente doble toque.
    }
  }, [sessionId])

  const spawnHeart = useCallback(() => {
    heartSeqRef.current += 1
    const id = heartSeqRef.current
    const offset = Math.round((id % 7) * 8 - 24)
    setHearts((current) => [...current.slice(-14), { id, offset }])
    setTimeout(() => {
      setHearts((current) => current.filter((heart) => heart.id !== id))
    }, 1100)
  }, [])

  const addLike = useCallback(() => {
    if (ended) return
    setLikes((current) => current + 1)
    pendingLikesRef.current += 1
    spawnHeart()
    if (!likeFlushTimerRef.current) {
      likeFlushTimerRef.current = setTimeout(() => {
        void flushLikes()
      }, LIKE_FLUSH_MS)
    }
  }, [ended, flushLikes, spawnHeart])

  useEffect(() => {
    return () => {
      if (likeFlushTimerRef.current) clearTimeout(likeFlushTimerRef.current)
    }
  }, [])

  const handleStageDouble = () => {
    addLike()
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || isSending || ended) return

    setIsSending(true)
    try {
      const payload = await sendLiveChatMessage(sessionId, text.slice(0, CHAT_MAX_LENGTH))
      if (payload?.message) {
        lastSeqRef.current = Math.max(lastSeqRef.current, Number(payload.message.seq) || 0)
        setMessages((current) => {
          if (current.some((m) => m.id === payload.message.id)) return current
          return [...current, payload.message].slice(-240)
        })
      }
      setDraft('')
      setShowEmojis(false)
      setRoomError('')
    } catch (sendError) {
      setRoomError(sendError instanceof Error ? sendError.message : 'No se pudo enviar el mensaje.')
    } finally {
      setIsSending(false)
    }
  }

  const handleShare = async () => {
    const title = room?.title ? `En vivo: ${room.title}` : 'Transmisión en vivo en VensuR'
    try {
      if (navigator.share) {
        await navigator.share({ title, url: shareUrl })
        return
      }
      await navigator.clipboard.writeText(shareUrl)
      setShareHint('Enlace copiado')
    } catch {
      setShareHint('Copia el enlace desde la barra del navegador')
    }
    setTimeout(() => setShareHint(''), 2200)
  }

  const ownerName = room?.ownerDisplayName || room?.ownerUsername || 'Transmisión'
  const liveOver = ended || room?.status === 'ended'

  const headerRight = useMemo(
    () => (
      <div className="sala-head-meta">
        <span className={`sala-live-pill ${liveOver ? 'off' : ''}`}>
          {liveOver ? 'FINALIZADO' : '● EN VIVO'}
        </span>
        <span className="sala-viewers">👁 {formatCount(viewerCount)} viendo</span>
      </div>
    ),
    [liveOver, viewerCount],
  )

  if (!isAuthenticated) {
    return (
      <section className="feed route-page sala-page">
        <div className="sala-guard panel">
          <h2>Sala en vivo</h2>
          <p>Inicia sesión para entrar al directo, comentar y reaccionar.</p>
          <Link to="/acceso">Ir a acceso</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="sala-page">
      <div className="sala-shell">
        <div className="sala-main">
          <header className="sala-head">
            <button className="sala-back" onClick={() => navigate('/vivo')} type="button">
              ‹ Salir
            </button>
            <div className="sala-head-title">
              <b>{room?.title || 'Transmisión en vivo'}</b>
              <small>{ownerName}</small>
            </div>
            {headerRight}
          </header>

          <div
            className="sala-stage"
            onDoubleClick={handleStageDouble}
            role="presentation"
          >
            <video
              className="sala-video"
              autoPlay
              muted={isMuted}
              playsInline
              ref={videoRef}
            />

            {!isWatching && !liveOver ? (
              <div className="sala-stage-overlay">
                <span className="sala-spinner" aria-hidden="true" />
                <p>{status || 'Conectando con la transmisión…'}</p>
              </div>
            ) : null}

            {liveOver ? (
              <div className="sala-stage-overlay">
                <p>La transmisión terminó.</p>
                <Link className="sala-back-link" to="/vivo">Ver otras transmisiones</Link>
              </div>
            ) : null}

            <div className="sala-hearts" aria-hidden="true">
              {hearts.map((heart) => (
                <span
                  className="sala-heart"
                  key={heart.id}
                  style={{ '--x': `${heart.offset}px` }}
                >
                  ❤️
                </span>
              ))}
            </div>

            <div className="sala-stage-hint" aria-hidden="true">
              Doble toque para reaccionar ❤️
            </div>
          </div>

          <div className="sala-actions">
            <button className="sala-action like" onClick={addLike} type="button" disabled={liveOver}>
              ❤️ <b>{formatCount(likes)}</b>
            </button>
            <button
              className="sala-action"
              onClick={() => setIsMuted((current) => !current)}
              type="button"
            >
              {isMuted ? '🔇 Activar sonido' : '🔊 Silenciar'}
            </button>
            <button className="sala-action" onClick={handleShare} type="button">
              ↗ Compartir
            </button>
            {shareHint ? <span className="sala-share-hint">{shareHint}</span> : null}
          </div>

          {viewerError ? <p className="route-message sala-error">{viewerError}</p> : null}
        </div>

        <aside className="sala-chat">
          <header className="sala-chat-head">
            <b>Chat en vivo</b>
            <span>{formatCount(viewerCount)} conectados</span>
          </header>

          <div className="sala-chat-list" ref={chatScrollRef}>
            {messages.length === 0 ? (
              <p className="sala-chat-empty">
                Sé el primero en escribir. Saluda a {ownerName} 👋
              </p>
            ) : (
              messages.map((message) => (
                <div
                  className={`sala-msg ${message.userId === user?.id ? 'mine' : ''}`}
                  key={message.id}
                >
                  <span className="sala-msg-avatar" aria-hidden="true">
                    {message.avatarUrl ? (
                      <img alt="" src={message.avatarUrl} />
                    ) : (
                      initialsOf(message.displayName)
                    )}
                  </span>
                  <p>
                    <b>{message.displayName}</b> {message.text}
                  </p>
                </div>
              ))
            )}
          </div>

          {roomError ? <p className="sala-chat-error">{roomError}</p> : null}

          {showEmojis ? (
            <div className="sala-emojis">
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => setDraft((current) => `${current}${emoji}`.slice(0, CHAT_MAX_LENGTH))}
                  type="button"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="sala-chat-form"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSend()
            }}
          >
            <button
              aria-label="Emojis"
              className="sala-emoji-toggle"
              onClick={() => setShowEmojis((current) => !current)}
              type="button"
            >
              😊
            </button>
            <input
              aria-label="Escribe un mensaje"
              disabled={liveOver}
              maxLength={CHAT_MAX_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={liveOver ? 'La transmisión terminó' : 'Escribe un mensaje…'}
              value={draft}
            />
            <button className="sala-send" disabled={!draft.trim() || isSending || liveOver} type="submit">
              {isSending ? '…' : 'Enviar'}
            </button>
          </form>
        </aside>
      </div>
    </section>
  )
}

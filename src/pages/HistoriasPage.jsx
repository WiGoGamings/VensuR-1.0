import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { markStoryViewed } from '../services/storiesApi'
import './Pages.css'

// Un video se repite hasta 3 veces; si el usuario no se mueve, pasa solo al siguiente.
const VIDEO_MAX_LOOPS = 3
// Las historias de solo imagen/texto avanzan solas tras unos segundos (sin barra visible).
const IMAGE_DURATION_MS = 7000

const STORY_FILTER_CSS_BY_NAME = {
  none: 'none',
  normal: 'none',
  warm: 'sepia(0.28) saturate(1.12) contrast(1.03)',
  cold: 'hue-rotate(170deg) saturate(0.92) brightness(1.02)',
  mono: 'grayscale(1)',
  dramatic: 'contrast(1.2) saturate(1.06) brightness(0.96)',
  clarendon: 'contrast(1.15) saturate(1.35) brightness(1.05)',
  gingham: 'sepia(0.12) contrast(0.9) brightness(1.08)',
  moon: 'grayscale(1) contrast(1.1) brightness(1.1)',
  lark: 'saturate(1.2) brightness(1.08) contrast(0.95)',
  reyes: 'sepia(0.35) contrast(0.85) brightness(1.1) saturate(0.9)',
  juno: 'saturate(1.4) contrast(1.05) sepia(0.1) hue-rotate(-8deg)',
  slumber: 'saturate(0.66) brightness(1.05) sepia(0.2)',
  crema: 'sepia(0.2) contrast(1.05) brightness(1.02) saturate(0.9)',
  ludwig: 'saturate(1.1) contrast(1.05) brightness(1.05) sepia(0.08)',
  aden: 'hue-rotate(-15deg) contrast(0.9) saturate(0.85) brightness(1.1)',
  perpetua: 'contrast(1.05) brightness(1.05) saturate(1.1) hue-rotate(5deg)',
}

const REEL_GRADIENTS = [
  'radial-gradient(circle at 25% 20%, #2b4d86, transparent 45%), linear-gradient(160deg, #0d1320, #241019)',
  'radial-gradient(circle at 75% 25%, #7a3a2b, transparent 45%), linear-gradient(160deg, #131a12, #241a10)',
  'radial-gradient(circle at 30% 75%, #2c6b63, transparent 45%), linear-gradient(160deg, #0c1720, #1c1226)',
  'radial-gradient(circle at 70% 70%, #6a2f52, transparent 45%), linear-gradient(160deg, #10131f, #200f18)',
]

function isVideoStory(story) {
  if (typeof story?.mediaType === 'string' && story.mediaType.startsWith('video/')) return true
  const mediaUrl = typeof story?.mediaUrl === 'string' ? story.mediaUrl.toLowerCase() : ''
  return /\.(mp4|webm|mov|m4v)(\?|$)/.test(mediaUrl)
}

function isAudioStory(story) {
  if (typeof story?.mediaType === 'string' && story.mediaType.startsWith('audio/')) return true
  const mediaUrl = typeof story?.mediaUrl === 'string' ? story.mediaUrl.toLowerCase() : ''
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/.test(mediaUrl)
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function normalizeStoryEditor(editor) {
  const source = editor && typeof editor === 'object' ? editor : {}
  const overlayText = typeof source.overlayText === 'string' ? source.overlayText.trim().slice(0, 180) : ''
  const locationTag = typeof source.locationTag === 'string' ? source.locationTag.trim().slice(0, 42) : ''
  const clockLabel = typeof source.clockLabel === 'string' ? source.clockLabel.trim().slice(0, 16) : ''
  const textColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(source.textColor || '') ? source.textColor : '#ffffff'
  const textSize = clampNumber(source.textSize, 18, 58, 34)
  const textPositionY = clampNumber(source.textPositionY, 10, 86, 72)
  const textAlign = ['left', 'center', 'right'].includes(source.textAlign) ? source.textAlign : 'center'
  const filter = STORY_FILTER_CSS_BY_NAME[source.filter] ? source.filter : 'none'
  return { overlayText, locationTag, clockLabel, textColor, textSize, textPositionY, textAlign, filter }
}

function resolveStoryFilter(filterName) {
  return STORY_FILTER_CSS_BY_NAME[filterName] || STORY_FILTER_CSS_BY_NAME.none
}

function readStoryMusic(story) {
  const music = story && typeof story.music === 'object' ? story.music : null
  if (!music) return null
  const previewUrl = typeof music.previewUrl === 'string' ? music.previewUrl : ''
  const title = typeof music.title === 'string' ? music.title.trim() : ''
  const artist = typeof music.artist === 'string' ? music.artist.trim() : ''
  if (!previewUrl || !title) return null
  return {
    ...music,
    previewUrl,
    title,
    artist,
    startSeconds: clampNumber(music.startSeconds, 0, 180, 0),
    volume: clampNumber(music.volume, 0.05, 1, 0.8),
  }
}

/**
 * Una historia a pantalla completa dentro del feed vertical.
 * @param {{
 *  story: any, index: number, active: boolean, loadMedia: boolean, muted: boolean,
 *  onAdvance: (index: number) => void, onToggleMute: () => void
 * }} props
 */
function StoryReel({ story, index, active, loadMedia, muted, onAdvance, onToggleMute }) {
  const mediaRef = useRef(null)
  const musicRef = useRef(null)
  const loopsRef = useRef(0)
  const [held, setHeld] = useState(false)

  const editor = useMemo(() => normalizeStoryEditor(story?.editor), [story?.editor])
  const music = useMemo(() => readStoryMusic(story), [story])

  const isVideo = isVideoStory(story)
  const isAudio = isAudioStory(story)
  const hasMedia = Boolean(story?.mediaUrl)
  const isImage = hasMedia && !isVideo && !isAudio
  const mediaFilter = resolveStoryFilter(editor.filter)
  const musicLabel = music ? `${music.title}${music.artist ? ` · ${music.artist}` : ''}` : ''
  const hasAudioTrack = isVideo || isAudio || Boolean(music?.previewUrl)
  const reactions = Number.isFinite(Number(story?.reactions)) ? Number(story.reactions) : 0

  // Reproduce / pausa según sea la historia activa.
  useEffect(() => {
    const media = mediaRef.current
    const musicEl = musicRef.current

    if (!active || held) {
      media?.pause?.()
      musicEl?.pause?.()
      return undefined
    }

    loopsRef.current = 0
    if (media) {
      try {
        media.currentTime = 0
      } catch {
        // no-op
      }
      media.play?.().catch(() => {})
    }
    if (musicEl) {
      try {
        musicEl.currentTime = music?.startSeconds || 0
      } catch {
        // no-op
      }
      musicEl.volume = music?.volume ?? 0.85
      musicEl.play?.().catch(() => {})
    }

    let imageTimer
    if (!isVideo && !isAudio) {
      imageTimer = window.setTimeout(() => onAdvance(index), IMAGE_DURATION_MS)
    }
    return () => {
      if (imageTimer) window.clearTimeout(imageTimer)
    }
  }, [active, held, isVideo, isAudio, index, music?.startSeconds, music?.volume, onAdvance])

  // Silencio (sin reiniciar el video).
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.muted = muted
    if (musicRef.current) musicRef.current.muted = muted
  }, [muted])

  const handleEnded = () => {
    loopsRef.current += 1
    if (loopsRef.current >= VIDEO_MAX_LOOPS) {
      onAdvance(index)
      return
    }
    const media = mediaRef.current
    if (media) {
      try {
        media.currentTime = 0
      } catch {
        // no-op
      }
      media.play?.().catch(() => {})
    }
  }

  const toggleHold = () => {
    setHeld((current) => {
      const next = !current
      const media = mediaRef.current
      if (media) {
        if (next) media.pause?.()
        else media.play?.().catch(() => {})
      }
      return next
    })
  }

  const gradient = REEL_GRADIENTS[index % REEL_GRADIENTS.length]

  return (
    <article className="reel" data-index={index}>
      <div
        className="reel-media"
        onClick={hasMedia && !isImage ? toggleHold : undefined}
        role={hasMedia && !isImage ? 'button' : undefined}
        style={{ background: gradient }}
      >
        {!loadMedia ? null : isVideo ? (
          <video
            className="reel-fill"
            muted={muted}
            onEnded={handleEnded}
            playsInline
            preload={active ? 'auto' : 'metadata'}
            ref={mediaRef}
            src={story.mediaUrl}
            style={{ filter: mediaFilter }}
          />
        ) : isImage ? (
          <img
            alt={story.label}
            className="reel-fill"
            loading={active ? 'eager' : 'lazy'}
            src={story.mediaUrl}
            style={{ filter: mediaFilter }}
          />
        ) : isAudio ? (
          <div className="reel-audio">
            <span>{story.label}</span>
            <small>Historia con audio</small>
            <audio muted={muted} onEnded={handleEnded} preload="metadata" ref={mediaRef} src={story.mediaUrl} />
          </div>
        ) : (
          <p className="reel-textcard">{editor.overlayText || story.label}</p>
        )}

        {loadMedia && music?.previewUrl && !isAudio ? (
          <audio loop muted={muted} preload="metadata" ref={musicRef} src={music.previewUrl} />
        ) : null}

        {editor.overlayText && (hasMedia || isVideo || isAudio) ? (
          <div
            className={`reel-overlay align-${editor.textAlign}`}
            style={{ color: editor.textColor, fontSize: `${editor.textSize}px`, top: `${editor.textPositionY}%` }}
          >
            {editor.overlayText}
          </div>
        ) : null}

        {editor.locationTag ? <span className="reel-chip reel-chip-loc">📍 {editor.locationTag}</span> : null}
        {editor.clockLabel ? <span className="reel-chip reel-chip-clock">🕒 {editor.clockLabel}</span> : null}
        {musicLabel ? <span className="reel-chip reel-chip-music">♪ {musicLabel}</span> : null}

        {held ? (
          <span className="reel-held" aria-hidden="true">
            ▶
          </span>
        ) : null}
      </div>

      {hasAudioTrack ? (
        <button
          aria-label={muted ? 'Activar sonido' : 'Silenciar'}
          className="reel-mute"
          onClick={(event) => {
            event.stopPropagation()
            onToggleMute()
          }}
          type="button"
        >
          {muted ? '🔇' : '🔊'}
        </button>
      ) : null}

      <footer className="reel-caption">
        <strong>{story.label}</strong>
        <p>
          {story.source || 'Comunidad'} · {reactions} {reactions === 1 ? 'reacción' : 'reacciones'}
        </p>
        {story.externalUrl ? (
          <a href={story.externalUrl} rel="noreferrer" target="_blank">
            Ver fuente
          </a>
        ) : null}
      </footer>
    </article>
  )
}

/**
 * @param {{ stories: import('../data/feedData').StoryItem[] }} props
 */
export default function HistoriasPage({ stories }) {
  const navigate = useNavigate()
  const { storyId } = useParams()
  const containerRef = useRef(null)
  const activeIndexRef = useRef(0)
  const scrollRafRef = useRef(0)
  const didInitRef = useRef(false)

  const [activeIndex, setActiveIndex] = useState(0)
  const [muted, setMuted] = useState(true)
  const [showSoundHint, setShowSoundHint] = useState(true)
  const [wantedId] = useState(() => (storyId ? String(storyId) : ''))

  const items = useMemo(() => {
    if (!Array.isArray(stories)) return []
    return stories.filter(Boolean).map((story, index) => ({
      ...story,
      id: story?.id ? String(story.id) : `story-${index}`,
      label: typeof story?.label === 'string' && story.label.trim() ? story.label.trim() : 'Historia',
    }))
  }, [stories])

  const scrollToIndex = useCallback(
    (index, smooth = true) => {
      const container = containerRef.current
      if (!container || items.length === 0) return
      const clamped = Math.max(0, Math.min(index, items.length - 1))
      container.scrollTo({ top: clamped * container.clientHeight, behavior: smooth ? 'smooth' : 'auto' })
    },
    [items.length],
  )

  // Avance automático (fin de video x3 o temporizador de imagen).
  const advanceFrom = useCallback(
    (index) => {
      if (index !== activeIndexRef.current) return
      if (index >= items.length - 1) return
      scrollToIndex(index + 1)
    },
    [items.length, scrollToIndex],
  )

  const toggleMute = useCallback(() => {
    setMuted((current) => !current)
    setShowSoundHint(false)
  }, [])

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current) return
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const container = containerRef.current
      if (!container) return
      const index = Math.round(container.scrollTop / Math.max(1, container.clientHeight))
      if (index !== activeIndexRef.current && index >= 0 && index < items.length) {
        activeIndexRef.current = index
        setActiveIndex(index)
      }
    })
  }, [items.length])

  // Posiciona en la historia pedida por la URL (una sola vez, al cargar).
  // No tocamos el estado aquí: al hacer scroll, handleScroll fija la activa.
  useEffect(() => {
    if (didInitRef.current || items.length === 0) return
    didInitRef.current = true
    if (!wantedId) return
    const index = items.findIndex((story) => story.id === wantedId)
    if (index > 0) scrollToIndex(index, false)
  }, [items, wantedId, scrollToIndex])

  // Sincroniza la URL + marca vista cuando cambia la historia activa.
  useEffect(() => {
    const story = items[activeIndex]
    if (!story) return
    if (story.id && !story.id.startsWith('story-')) {
      void markStoryViewed(story.id)
      if (story.id !== storyId) {
        navigate(`/historias/${encodeURIComponent(story.id)}`, { replace: true })
      }
    }
  }, [activeIndex, items, navigate, storyId])

  // Flechas del teclado para navegar.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        scrollToIndex(activeIndexRef.current + 1)
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        scrollToIndex(activeIndexRef.current - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scrollToIndex])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  if (items.length === 0) {
    return (
      <section className="feed route-page reels-empty">
        <p className="route-message">No hay historias para mostrar todavía.</p>
        <Link className="reel-back-link" to="/">
          Volver al inicio
        </Link>
      </section>
    )
  }

  return (
    <section className="reels-page">
      <div className="reels-frame">
        <Link className="reels-close" to="/" aria-label="Cerrar historias">
          ✕
        </Link>

        {showSoundHint ? (
          <button className="reels-sound-hint" onClick={toggleMute} type="button">
            🔇 Toca para activar el sonido
          </button>
        ) : null}

        <div className="reels-viewer" onScroll={handleScroll} ref={containerRef}>
          {items.map((story, index) => (
            <StoryReel
              active={index === activeIndex}
              index={index}
              key={story.id}
              loadMedia={Math.abs(index - activeIndex) <= 1}
              muted={muted}
              onAdvance={advanceFrom}
              onToggleMute={toggleMute}
              story={story}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

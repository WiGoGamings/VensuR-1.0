import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getStoriesFeed, markStoryViewed } from '../services/storiesApi'
import './Pages.css'

// Un video se repite hasta 3 veces; si el usuario no se mueve, pasa solo al siguiente.
const VIDEO_MAX_LOOPS = 3
// Las historias de solo imagen avanzan solas tras unos segundos (sin barra visible).
const IMAGE_DURATION_MS = 7000
// Feed infinito: se recicla el contenido y se recorta por arriba para no crecer sin límite.
const MAX_FEED = 90
const BATCH_SIZE = 12
const PRELOAD_WHEN_LEFT = 4
const TRIM_KEEP_ABOVE = 14

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

function isVideoUrl(url, type) {
  if (typeof type === 'string' && type.startsWith('video/')) return true
  const value = typeof url === 'string' ? url.toLowerCase() : ''
  return /\.(mp4|webm|mov|m4v)(\?|$)/.test(value)
}

function isAudioUrl(url, type) {
  if (typeof type === 'string' && type.startsWith('audio/')) return true
  const value = typeof url === 'string' ? url.toLowerCase() : ''
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/.test(value)
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

function readStoryMusic(music) {
  if (!music || typeof music !== 'object') return null
  const previewUrl = typeof music.previewUrl === 'string' ? music.previewUrl : ''
  const title = typeof music.title === 'string' ? music.title.trim() : ''
  if (!previewUrl || !title) return null
  return {
    previewUrl,
    title,
    artist: typeof music.artist === 'string' ? music.artist.trim() : '',
    startSeconds: clampNumber(music.startSeconds, 0, 180, 0),
    volume: clampNumber(music.volume, 0.05, 1, 0.8),
  }
}

/** Convierte una historia del feed de layout (id "user-x"/"news-x") en un item de reel. */
function propStoryToReel(story) {
  const mediaUrl = typeof story?.mediaUrl === 'string' ? story.mediaUrl : ''
  if (!mediaUrl) return null
  const rawId = String(story?.id || '')
  return {
    poolId: rawId || mediaUrl,
    realId: rawId.startsWith('user-') ? rawId.slice(5) : '',
    label: typeof story?.label === 'string' && story.label.trim() ? story.label.trim() : 'Historia',
    mediaUrl,
    mediaType: typeof story?.mediaType === 'string' ? story.mediaType : '',
    reactions: Number(story?.reactions ?? 0),
    source: story?.source || 'Comunidad',
    editor: story?.editor,
    music: story?.music,
    externalUrl: typeof story?.externalUrl === 'string' ? story.externalUrl : '',
  }
}

/** Convierte una historia de /api/content/stories en un item de reel. */
function apiStoryToReel(story) {
  const mediaUrl = typeof story?.mediaUrl === 'string' ? story.mediaUrl : ''
  if (!mediaUrl) return null
  const realId = String(story?.id || '')
  return {
    poolId: `user-${realId}`,
    realId,
    label: (story?.author || story?.title || 'Comunidad').toString().trim().slice(0, 42) || 'Historia',
    mediaUrl,
    mediaType: typeof story?.mediaType === 'string' ? story.mediaType : '',
    reactions: Number(story?.reactions ?? 0),
    source: 'Comunidad',
    editor: story?.editor,
    music: story?.music,
    externalUrl: '',
  }
}

function shuffled(list) {
  if (list.length < 2) return list.slice()
  const copy = list.slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * Una historia a pantalla completa dentro del feed vertical.
 * @param {{
 *  reel: any, index: number, active: boolean, loadMedia: boolean, muted: boolean,
 *  onAdvance: (key: string) => void, onToggleMute: () => void
 * }} props
 */
function StoryReel({ reel, index, active, loadMedia, muted, onAdvance, onToggleMute }) {
  const mediaRef = useRef(null)
  const musicRef = useRef(null)
  const loopsRef = useRef(0)
  const [held, setHeld] = useState(false)

  const reelKey = reel.key
  const mediaUrl = reel.mediaUrl
  const mediaType = reel.mediaType
  const rawEditor = reel.editor
  const rawMusic = reel.music

  const editor = useMemo(() => normalizeStoryEditor(rawEditor), [rawEditor])
  const music = useMemo(() => readStoryMusic(rawMusic), [rawMusic])

  const isVideo = isVideoUrl(mediaUrl, mediaType)
  const isAudio = isAudioUrl(mediaUrl, mediaType)
  const isImage = Boolean(mediaUrl) && !isVideo && !isAudio
  const mediaFilter = resolveStoryFilter(editor.filter)
  const musicLabel = music ? `${music.title}${music.artist ? ` · ${music.artist}` : ''}` : ''
  const hasAudioTrack = isVideo || isAudio || Boolean(music?.previewUrl)
  const reactions = Number.isFinite(Number(reel.reactions)) ? Number(reel.reactions) : 0

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
      imageTimer = window.setTimeout(() => onAdvance(reelKey), IMAGE_DURATION_MS)
    }
    return () => {
      if (imageTimer) window.clearTimeout(imageTimer)
    }
  }, [active, held, isVideo, isAudio, reelKey, music?.startSeconds, music?.volume, onAdvance])

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.muted = muted
    if (musicRef.current) musicRef.current.muted = muted
  }, [muted])

  const handleEnded = () => {
    loopsRef.current += 1
    if (loopsRef.current >= VIDEO_MAX_LOOPS) {
      onAdvance(reelKey)
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
    <article className="reel">
      <div
        className="reel-media"
        onClick={mediaUrl && !isImage ? toggleHold : undefined}
        role={mediaUrl && !isImage ? 'button' : undefined}
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
            src={mediaUrl}
            style={{ filter: mediaFilter }}
          />
        ) : isImage ? (
          <img
            alt={reel.label}
            className="reel-fill"
            loading={active ? 'eager' : 'lazy'}
            src={mediaUrl}
            style={{ filter: mediaFilter }}
          />
        ) : isAudio ? (
          <div className="reel-audio">
            <span>{reel.label}</span>
            <small>Historia con audio</small>
            <audio muted={muted} onEnded={handleEnded} preload="metadata" ref={mediaRef} src={mediaUrl} />
          </div>
        ) : (
          <p className="reel-textcard">{editor.overlayText || reel.label}</p>
        )}

        {loadMedia && music?.previewUrl && !isAudio ? (
          <audio loop muted={muted} preload="metadata" ref={musicRef} src={music.previewUrl} />
        ) : null}

        {editor.overlayText && mediaUrl ? (
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
        <strong>{reel.label}</strong>
        <p>
          {reel.source || 'Comunidad'} · {reactions} {reactions === 1 ? 'reacción' : 'reacciones'}
        </p>
        {reel.externalUrl ? (
          <a href={reel.externalUrl} rel="noreferrer" target="_blank">
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
  const scrollRafRef = useRef(0)
  const loadingRef = useRef(false)
  const lastLoadAtRef = useRef(0)
  const keySeqRef = useRef(0)
  const feedRef = useRef([])
  const activeKeyRef = useRef('')
  const seededRef = useRef(false)
  const didInitScrollRef = useRef(false)
  const pendingScrollAdjustRef = useRef(0)

  const [feed, setFeed] = useState([])
  const [apiPool, setApiPool] = useState([])
  const [activeKey, setActiveKey] = useState('')
  const [muted, setMuted] = useState(true)
  const [showSoundHint, setShowSoundHint] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [wantedId] = useState(() => (storyId ? String(storyId) : ''))

  const propPool = useMemo(
    () => (Array.isArray(stories) ? stories.map(propStoryToReel).filter(Boolean) : []),
    [stories],
  )

  const pool = useMemo(() => {
    const byId = new Map()
    for (const reel of [...propPool, ...apiPool]) byId.set(reel.poolId, reel)
    return Array.from(byId.values())
  }, [propPool, apiPool])

  const makeBatch = useCallback((source, count) => {
    if (source.length === 0) return []
    const order = shuffled(source)
    const out = []
    for (let i = 0; i < count; i += 1) {
      const base = order[i % order.length]
      keySeqRef.current += 1
      out.push({ ...base, key: `r${keySeqRef.current}` })
    }
    return out
  }, [])

  useEffect(() => {
    feedRef.current = feed
  }, [feed])
  useEffect(() => {
    activeKeyRef.current = activeKey
  }, [activeKey])

  const activeIndex = useMemo(() => {
    const i = feed.findIndex((reel) => reel.key === activeKey)
    return i >= 0 ? i : 0
  }, [feed, activeKey])

  const scrollToIndex = useCallback((index, smooth = true) => {
    const container = containerRef.current
    if (!container) return
    const list = feedRef.current
    const clamped = Math.max(0, Math.min(index, list.length - 1))
    container.scrollTo({ top: clamped * container.clientHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return
    if (Date.now() - lastLoadAtRef.current < 700) return
    const source = pool
    if (source.length === 0 && feedRef.current.length === 0) return

    loadingRef.current = true
    setIsLoadingMore(true)
    try {
      // Trae un lote más amplio de historias la primera vez (el prop trae solo ~16).
      if (apiPool.length === 0) {
        try {
          const payload = await getStoriesFeed()
          const mapped = Array.isArray(payload?.items)
            ? payload.items.map(apiStoryToReel).filter(Boolean)
            : []
          if (mapped.length) setApiPool(mapped)
        } catch {
          // seguimos con lo que haya
        }
      }

      // Que el círculo de carga se alcance a ver.
      await new Promise((resolve) => setTimeout(resolve, 420))

      setFeed((current) => {
        const basis = source.length
          ? source
          : current.map((reel) => {
              const copy = { ...reel }
              delete copy.key
              return copy
            })
        const batch = makeBatch(basis, BATCH_SIZE)
        if (batch.length === 0) return current

        let next = [...current, ...batch]
        const activeI = current.findIndex((reel) => reel.key === activeKeyRef.current)
        const overflow = next.length - MAX_FEED
        if (overflow > 0 && activeI - overflow >= TRIM_KEEP_ABOVE) {
          next = next.slice(overflow)
          pendingScrollAdjustRef.current += overflow
        }
        return next
      })
    } finally {
      lastLoadAtRef.current = Date.now()
      loadingRef.current = false
      setIsLoadingMore(false)
    }
  }, [apiPool.length, makeBatch, pool])

  const advanceFromKey = useCallback(
    (key) => {
      const list = feedRef.current
      const index = list.findIndex((reel) => reel.key === key)
      if (index < 0) return
      const activeI = list.findIndex((reel) => reel.key === activeKeyRef.current)
      if (index !== activeI) return
      if (index >= list.length - 1) {
        void loadMore()
        return
      }
      scrollToIndex(index + 1)
    },
    [loadMore, scrollToIndex],
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
      const list = feedRef.current
      const height = Math.max(1, container.clientHeight)
      const index = Math.round(container.scrollTop / height)

      if (list[index] && list[index].key !== activeKeyRef.current) {
        setActiveKey(list[index].key)
      }

      const nearBottom =
        index >= list.length - PRELOAD_WHEN_LEFT ||
        container.scrollTop + container.clientHeight >= container.scrollHeight - height * 0.6
      if (nearBottom) void loadMore()
    })
  }, [loadMore])

  // Semilla del feed cuando el pool está listo (patrón async para no llamar setState en el cuerpo del efecto).
  useEffect(() => {
    if (seededRef.current || pool.length === 0) return undefined
    let alive = true
    const seed = async () => {
      if (!alive || seededRef.current) return
      seededRef.current = true
      const first = makeBatch(pool, Math.min(pool.length, BATCH_SIZE * 2))
      setFeed(first)
      setActiveKey(first[0]?.key || '')
    }
    void seed()
    return () => {
      alive = false
    }
  }, [pool, makeBatch])

  // Compensa el scroll cuando se recortan reels por arriba (feed infinito sin saltos).
  useLayoutEffect(() => {
    const n = pendingScrollAdjustRef.current
    if (n > 0 && containerRef.current) {
      const container = containerRef.current
      container.scrollTop = Math.max(0, container.scrollTop - n * container.clientHeight)
      pendingScrollAdjustRef.current = 0
    }
  }, [feed])

  // Posiciona en la historia pedida por la URL (una vez).
  useEffect(() => {
    if (didInitScrollRef.current || feed.length === 0) return
    didInitScrollRef.current = true
    if (!wantedId) return
    const index = feed.findIndex((reel) => reel.realId === wantedId)
    if (index > 0) scrollToIndex(index, false)
  }, [feed, wantedId, scrollToIndex])

  // URL + marca de vista al cambiar de historia activa.
  useEffect(() => {
    const reel = feed.find((item) => item.key === activeKey)
    if (!reel?.realId) return
    void markStoryViewed(reel.realId)
    if (reel.realId !== storyId) {
      navigate(`/historias/${encodeURIComponent(reel.realId)}`, { replace: true })
    }
  }, [activeKey, feed, navigate, storyId])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        scrollToIndex(activeIndex + 1)
      } else if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        scrollToIndex(activeIndex - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, scrollToIndex])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  if (pool.length === 0) {
    return (
      <section className="feed route-page reels-empty">
        <p className="route-message">No hay historias para mostrar todavía.</p>
        <Link className="reel-back-link" to="/">
          Volver al inicio
        </Link>
      </section>
    )
  }

  const showSpinner = isLoadingMore && activeIndex >= feed.length - 3

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
          {feed.map((reel, index) => (
            <StoryReel
              active={index === activeIndex}
              index={index}
              key={reel.key}
              loadMedia={Math.abs(index - activeIndex) <= 1}
              muted={muted}
              onAdvance={advanceFromKey}
              onToggleMute={toggleMute}
              reel={reel}
            />
          ))}
          <div className="reels-tail" aria-hidden={!showSpinner}>
            <span className="reels-spinner" />
          </div>
        </div>

        {showSpinner ? (
          <div className="reels-loading" role="status">
            <span className="reels-spinner reels-spinner-lg" />
            <span>Cargando más historias…</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

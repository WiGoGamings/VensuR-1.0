import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import './Pages.css'

const DEFAULT_STORY_DURATION_MS = 5_000
const STORY_DURATION_STORAGE_KEY = 'vensur.story.duration.ms'
const STORY_DURATION_OPTIONS = [
  { label: '3s', value: 3_000 },
  { label: '5s', value: 5_000 },
  { label: '7s', value: 7_000 },
  { label: '10s', value: 10_000 },
]

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

function readSavedDuration() {
  if (typeof window === 'undefined') return DEFAULT_STORY_DURATION_MS

  const raw = window.localStorage.getItem(STORY_DURATION_STORAGE_KEY)
  const parsed = Number.parseInt(raw ?? '', 10)
  const isAllowed = STORY_DURATION_OPTIONS.some((option) => option.value === parsed)

  return isAllowed ? parsed : DEFAULT_STORY_DURATION_MS
}

function isVideoStory(story) {
  if (typeof story?.mediaType === 'string' && story.mediaType.startsWith('video/')) {
    return true
  }

  const mediaUrl = typeof story?.mediaUrl === 'string' ? story.mediaUrl.toLowerCase() : ''
  return /\.(mp4|webm|mov|m4v)(\?|$)/.test(mediaUrl)
}

function isAudioStory(story) {
  if (typeof story?.mediaType === 'string' && story.mediaType.startsWith('audio/')) {
    return true
  }

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
  const textColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(source.textColor || '')
    ? source.textColor
    : '#ffffff'
  const textSize = clampNumber(source.textSize, 18, 58, 34)
  const textPositionY = clampNumber(source.textPositionY, 10, 86, 72)
  const textAlign = ['left', 'center', 'right'].includes(source.textAlign) ? source.textAlign : 'center'
  const filter = STORY_FILTER_CSS_BY_NAME[source.filter] ? source.filter : 'none'

  return {
    overlayText,
    locationTag,
    clockLabel,
    textColor,
    textSize,
    textPositionY,
    textAlign,
    filter,
  }
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

function storyPath(storyId) {
  return `/historias/${encodeURIComponent(String(storyId))}`
}

/**
 * @param {{
 * stories: import('../data/feedData').StoryItem[]
 * }} props
 */
export default function HistoriasPage({ stories }) {
  const navigate = useNavigate()
  const { storyId } = useParams()
  const mediaRef = useRef(null)
  const musicRef = useRef(null)
  const [storyDurationMs, setStoryDurationMs] = useState(readSavedDuration)
  const [isPaused, setIsPaused] = useState(false)
  const [isMuted, setIsMuted] = useState(false)

  const items = useMemo(() => {
    if (!Array.isArray(stories)) return []

    return stories
      .filter(Boolean)
      .map((story, index) => ({
        ...story,
        id: story?.id ? String(story.id) : `story-${index}`,
        label: typeof story?.label === 'string' && story.label.trim() ? story.label.trim() : 'Historia',
      }))
  }, [stories])

  const currentIndex = useMemo(() => {
    if (!items.length) return -1
    if (!storyId) return 0

    const index = items.findIndex((story) => story.id === storyId)
    return index >= 0 ? index : 0
  }, [items, storyId])

  const currentStory = currentIndex >= 0 ? items[currentIndex] : null
  const storyEditor = useMemo(() => normalizeStoryEditor(currentStory?.editor), [currentStory?.editor])
  const storyMusic = useMemo(() => readStoryMusic(currentStory), [currentStory])

  useEffect(() => {
    if (!items.length || currentIndex < 0) return

    const selected = items[currentIndex]
    if (!selected) return
    if (selected.id === storyId) return

    navigate(storyPath(selected.id), { replace: true })
  }, [currentIndex, items, navigate, storyId])

  useEffect(() => {
    if (items.length < 2 || currentIndex < 0 || isPaused) return

    const timerId = window.setTimeout(() => {
      const nextIndex = (currentIndex + 1) % items.length
      const nextStory = items[nextIndex]
      if (!nextStory) return

      navigate(storyPath(nextStory.id), { replace: true })
    }, storyDurationMs)

    return () => {
      window.clearTimeout(timerId)
    }
  }, [currentIndex, isPaused, items, navigate, storyDurationMs])

  useEffect(() => {
    const mediaElement = mediaRef.current
    const musicElement = musicRef.current

    if (mediaElement) {
      mediaElement.muted = isMuted

      const playAttempt = mediaElement.play?.()
      if (playAttempt && typeof playAttempt.catch === 'function') {
        playAttempt.catch(() => {
          if (!isMuted) {
            setIsMuted(true)
          }
        })
      }
    }

    if (musicElement) {
      musicElement.muted = isMuted

      const volume = Number.isFinite(Number(storyMusic?.volume))
        ? Number(storyMusic.volume)
        : 0.8
      musicElement.volume = Math.max(0.05, Math.min(1, volume))

      const startSeconds = Number.isFinite(Number(storyMusic?.startSeconds))
        ? Number(storyMusic.startSeconds)
        : 0
      const targetTime = Math.max(0, startSeconds)

      try {
        if (Math.abs((musicElement.currentTime || 0) - targetTime) > 0.75) {
          musicElement.currentTime = targetTime
        }
      } catch {
        // No-op.
      }

      const musicPlay = musicElement.play?.()
      if (musicPlay && typeof musicPlay.catch === 'function') {
        musicPlay.catch(() => {
          if (!isMuted) {
            setIsMuted(true)
          }
        })
      }
    }
  }, [currentStory?.id, isMuted, storyMusic?.startSeconds, storyMusic?.volume])

  function handleDurationChange(event) {
    const nextValue = Number.parseInt(event.target.value, 10)
    const selected = STORY_DURATION_OPTIONS.find((option) => option.value === nextValue)
    const value = selected ? selected.value : DEFAULT_STORY_DURATION_MS

    setStoryDurationMs(value)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORY_DURATION_STORAGE_KEY, String(value))
    }
  }

  function goToRelative(step) {
    if (!items.length || currentIndex < 0) return

    const nextIndex = (currentIndex + step + items.length) % items.length
    const nextStory = items[nextIndex]
    if (!nextStory) return

    navigate(storyPath(nextStory.id), { replace: true })
  }

  if (!currentStory) {
    return (
      <section className="feed route-page stories-view-page">
        <p className="route-message">No hay historias para mostrar todavia.</p>
        <Link className="stories-view-back" to="/">
          Volver al inicio
        </Link>
      </section>
    )
  }

  const isVideo = isVideoStory(currentStory)
  const isAudio = isAudioStory(currentStory)
  const hasAudioTrack = isVideo || isAudio || Boolean(storyMusic?.previewUrl)
  const storyReactions = Number.isFinite(Number(currentStory.reactions))
    ? Number(currentStory.reactions)
    : 0
  const mediaFilter = resolveStoryFilter(storyEditor.filter)
  const storyMusicLabel = storyMusic
    ? `${storyMusic.title}${storyMusic.artist ? ` · ${storyMusic.artist}` : ''}`
    : ''

  return (
    <section className="feed route-page stories-view-page">
      <header className="stories-view-top">
        <Link className="stories-view-back" to="/">
          Volver al inicio
        </Link>

        <label className="stories-view-speed">
          Duracion
          <select onChange={handleDurationChange} value={storyDurationMs}>
            {STORY_DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="stories-view-progress" aria-label="Progreso de historias">
          {items.map((story, index) => {
            const isActive = index === currentIndex
            const isViewed = index < currentIndex

            return (
              <span
                className={`stories-view-progress-item ${isViewed ? 'viewed' : ''}`}
                key={story.id}
              >
                {isActive ? (
                  <span
                    className="stories-view-progress-run"
                    key={`${story.id}-${storyDurationMs}`}
                    style={{
                      animationDuration: `${storyDurationMs}ms`,
                      animationPlayState: isPaused ? 'paused' : 'running',
                    }}
                  />
                ) : null}
              </span>
            )
          })}
        </div>

        <span className="stories-view-count">
          {currentIndex + 1}/{items.length}
        </span>
      </header>

      <article
        className="stories-view-stage"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {currentStory.mediaUrl ? (
          isVideo ? (
            <video
              autoPlay
              className="stories-view-media"
              muted={isMuted}
              playsInline
              preload="metadata"
              ref={mediaRef}
              src={currentStory.mediaUrl}
              style={{ filter: mediaFilter }}
            />
          ) : isAudio ? (
            <div className="stories-view-fallback stories-view-fallback-audio">
              <span>{currentStory.label}</span>
              <small>Historia con musica/audio</small>
              <audio
                autoPlay
                className="stories-view-audio-player"
                muted={isMuted}
                preload="metadata"
                ref={mediaRef}
                src={currentStory.mediaUrl}
              />
            </div>
          ) : (
            <img
              alt={currentStory.label}
              className="stories-view-media"
              loading="eager"
              src={currentStory.mediaUrl}
              style={{ filter: mediaFilter }}
            />
          )
        ) : (
          <div className="stories-view-fallback">
            <span>{currentStory.label}</span>
          </div>
        )}

        {storyMusic?.previewUrl && !isAudio ? (
          <audio
            autoPlay
            className="stories-view-hidden-audio"
            loop
            muted={isMuted}
            preload="metadata"
            ref={musicRef}
            src={storyMusic.previewUrl}
          />
        ) : null}

        {storyEditor.overlayText ? (
          <div
            className={`stories-view-overlay align-${storyEditor.textAlign}`}
            style={{
              color: storyEditor.textColor,
              fontSize: `${storyEditor.textSize}px`,
              top: `${storyEditor.textPositionY}%`,
            }}
          >
            {storyEditor.overlayText}
          </div>
        ) : null}

        {storyEditor.locationTag ? (
          <span className="stories-view-overlay-location">📍 {storyEditor.locationTag}</span>
        ) : null}

        {storyEditor.clockLabel ? (
          <span className="stories-view-overlay-clock">🕒 {storyEditor.clockLabel}</span>
        ) : null}

        {storyMusicLabel ? (
          <span className="stories-view-overlay-music">♪ {storyMusicLabel}</span>
        ) : null}

        <button
          aria-label="Historia anterior"
          className="stories-view-nav prev"
          onClick={() => goToRelative(-1)}
          type="button"
        >
          ‹
        </button>
        <button
          aria-label="Historia siguiente"
          className="stories-view-nav next"
          onClick={() => goToRelative(1)}
          type="button"
        >
          ›
        </button>

        {hasAudioTrack ? (
          <button
            aria-label={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
            className={`stories-view-audio-toggle ${isMuted ? 'muted' : 'unmuted'}`}
            onClick={() => setIsMuted((current) => !current)}
            title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
            type="button"
          >
            <span className="stories-view-audio-icon" aria-hidden="true">
              <span className="stories-view-audio-waves" />
            </span>
          </button>
        ) : null}

        <footer className="stories-view-caption">
          <div>
            <strong>{currentStory.label}</strong>
            <p>
              {currentStory.source || 'Comunidad'}
              {isPaused ? ' · Pausado' : ''}
              {` · ${storyReactions} reacciones`}
            </p>
            {storyMusicLabel ? <p className="stories-view-music-meta">Musica: {storyMusicLabel}</p> : null}
          </div>

          {currentStory.externalUrl ? (
            <a href={currentStory.externalUrl} rel="noreferrer">
              Ver fuente
            </a>
          ) : null}
        </footer>
      </article>
    </section>
  )
}
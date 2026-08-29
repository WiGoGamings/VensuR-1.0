import { memo } from 'react'
import './StoriesStrip.css'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const GRADIENTS = [
  'linear-gradient(150deg, #334862, #861d32)',
  'linear-gradient(150deg, #704b28, #262a36)',
  'linear-gradient(150deg, #283c68, #551f32)',
  'linear-gradient(150deg, #556637, #20242c)',
  'linear-gradient(150deg, #38596a, #4f2d47)',
  'linear-gradient(150deg, #24489d, #12b5a5)',
]

function isVideoStory(story) {
  if (typeof story?.mediaType === 'string' && story.mediaType.startsWith('video/')) return true
  const url = typeof story?.mediaUrl === 'string' ? story.mediaUrl.toLowerCase() : ''
  return /\.(mp4|webm|mov|m4v)(\?|$)/.test(url)
}

function isAudioStory(story) {
  if (typeof story?.mediaType === 'string' && story.mediaType.startsWith('audio/')) return true
  const url = typeof story?.mediaUrl === 'string' ? story.mediaUrl.toLowerCase() : ''
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/.test(url)
}

function initialsOf(name) {
  const text = String(name || '').trim()
  if (!text) return 'VR'
  const parts = text.split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase() || 'VR'
}

function storyPath(storyId) {
  return `/historias/${encodeURIComponent(String(storyId))}`
}

/**
 * @param {{ stories: import('../../data/feedData').StoryItem[] }} props
 */
function StoriesStrip({ stories }) {
  const navigate = useNavigate()
  const { user } = useAuth()

  function openStory(story) {
    if (story?.id) navigate(storyPath(story.id))
  }

  function onCreate() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('vensur:open-story-studio'))
    }
  }

  const firstWithImage = stories.find((s) => s?.mediaUrl && !isVideoStory(s) && !isAudioStory(s))

  return (
    <div className="stories-tray" id="stories">
      <button className="story-card story-card--create" onClick={onCreate} type="button">
        <span className="story-card__media">
          {user?.avatarUrl ? (
            <img alt="" decoding="async" loading="lazy" src={user.avatarUrl} />
          ) : firstWithImage ? (
            <img alt="" decoding="async" loading="lazy" src={firstWithImage.mediaUrl} />
          ) : (
            <span className="story-card__fill" style={{ background: GRADIENTS[5] }} />
          )}
        </span>
        <span className="story-card__create-plus" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="story-card__create-label">Crear historia</span>
      </button>

      {stories.map((story, index) => {
        const video = isVideoStory(story)
        const audio = isAudioStory(story)
        const hasImage = Boolean(story?.mediaUrl) && !video && !audio
        const liveBadge = Boolean(story?.live) || video
        const avatarName = story?.author || story?.label

        return (
          <button
            className={`story-card ${story?.seen ? 'is-seen' : ''}`}
            key={story.id}
            onClick={() => openStory(story)}
            title={story?.source ? `${story.label} · ${story.source}` : story.label}
            type="button"
          >
            <span className="story-card__media">
              {hasImage ? (
                <img alt="" decoding="async" loading="lazy" src={story.mediaUrl} />
              ) : (
                <span
                  className="story-card__fill"
                  style={{ background: GRADIENTS[index % GRADIENTS.length] }}
                />
              )}
              {video ? (
                <span className="story-card__play" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              ) : audio ? (
                <span className="story-card__play" aria-hidden="true">♪</span>
              ) : null}
            </span>

            <span className="story-card__ring">
              {hasImage ? <img alt="" src={story.mediaUrl} /> : <b>{initialsOf(avatarName)}</b>}
            </span>

            {liveBadge ? (
              <span className="story-card__badge">
                <i aria-hidden="true" /> EN VIVO
              </span>
            ) : story?.source === 'Noticia' ? (
              <span className="story-card__badge news">Noticia</span>
            ) : null}

            <span className="story-card__name">{story.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default memo(StoriesStrip)

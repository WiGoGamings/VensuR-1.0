import { memo } from 'react'
import './StoriesStrip.css'
import { useNavigate } from 'react-router-dom'

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

function storyPath(storyId) {
  return `/historias/${encodeURIComponent(String(storyId))}`
}

/**
 * @param {{ stories: import('../../data/feedData').StoryItem[] }} props
 */
function StoriesStrip({ stories }) {
  const navigate = useNavigate()

  function openStory(story) {
    if (!story?.id) return
    navigate(storyPath(story.id))
  }

  return (
    <div className="stories" id="stories">
      <button className="story create" type="button">
        <span className="plus">+</span>
        <strong>Tu historia</strong>
      </button>

      {stories.map((story, index) => {
        const isVideo = isVideoStory(story)
        const isAudio = isAudioStory(story)
        const hasMediaImage = Boolean(story?.mediaUrl) && !isVideo && !isAudio
        const showLiveBadge = story?.live || isVideo || isAudio

        return (
          <button
            className={`story story-${index} ${story.seen ? 'seen' : ''} ${showLiveBadge ? 'live' : ''}`}
            onClick={() => openStory(story)}
            title={story?.source ? `${story.label} · ${story.source}` : story.label}
            type="button"
            key={story.id}
          >
            <span className="story-ring">
              {hasMediaImage ? (
                <img alt={story.label} decoding="async" loading="lazy" src={story.mediaUrl} />
              ) : (
                <i className={isVideo ? 'video' : isAudio ? 'audio' : ''} />
              )}
            </span>
            <strong>{story.label}</strong>
            {showLiveBadge ? <b>EN VIVO</b> : null}
            {story?.externalUrl ? <em className="story-link">↗</em> : null}
          </button>
        )
      })}
    </div>
  )
}

export default memo(StoriesStrip)

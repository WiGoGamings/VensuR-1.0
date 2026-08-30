import { memo, useEffect, useRef, useState } from 'react'
import './PostCard.css'
import { Link } from 'react-router-dom'

/**
 * @param {string} author
 */
function authorToHandle(author) {
  return author.toLowerCase().replaceAll(' ', '_')
}

function hideBrokenImage(event) {
  const el = event.currentTarget
  el.style.display = 'none'
  el.closest?.('.post-media')?.classList.add('media-failed')
}

/**
 * @param {{
 * post: import('../../data/feedData').Post,
 * liked: boolean,
 * onToggleLike: (id: string | number) => void
 * }} props
 */
function PostCard({ post, liked, onToggleLike }) {
  const isVideo =
    typeof post.mediaUrl === 'string' && /\.(mp4|webm|mov|m4v)$/i.test(post.mediaUrl)
  const isAudio =
    typeof post.mediaUrl === 'string' && /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(post.mediaUrl)
  const mediaRef = useRef(null)
  const hasAudioTrack = isVideo || isAudio
  const [isMuted, setIsMuted] = useState(false)

  useEffect(() => {
    const mediaElement = mediaRef.current
    if (!mediaElement) return
    mediaElement.muted = isMuted
  }, [isMuted, post.id])

  return (
    <article className="post">
      <div className="post-header">
        <div className={`avatar avatar-${post.tone}`} aria-hidden="true" />
        <div>
          <strong>{post.author}</strong>
          <span>{post.meta}</span>
        </div>
        <span className={`tag ${post.tagClass}`}>{post.tag}</span>
        <button className="more" type="button" aria-label="Mas opciones">
          ...
        </button>
      </div>

      <div className={`post-media media-${post.tone}`}>
        {post.mediaUrl ? (
          isVideo ? (
            <video
              className="post-media-file"
              controls
              muted={isMuted}
              playsInline
              preload="metadata"
              ref={mediaRef}
              src={post.mediaUrl}
            />
          ) : isAudio ? (
            <audio
              className="post-audio-file"
              controls
              muted={isMuted}
              preload="metadata"
              ref={mediaRef}
              src={post.mediaUrl}
            />
          ) : (
            <img alt={post.media} className="post-media-file" decoding="async" loading="lazy" onError={hideBrokenImage} src={post.mediaUrl} />
          )
        ) : (
          <div className="post-media-empty">
            <strong>{post.media || 'Publicacion ciudadana'}</strong>
            <small>{post.caption || 'Sin imagen, video o audio adjunto.'}</small>
          </div>
        )}

        {hasAudioTrack ? (
          <button
            aria-label={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
            className={`post-media-audio-toggle ${isMuted ? 'muted' : 'unmuted'}`}
            onClick={() => setIsMuted((current) => !current)}
            title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
            type="button"
          >
            <span className="post-media-audio-icon" aria-hidden="true">
              <span className="post-media-audio-waves" />
            </span>
          </button>
        ) : null}

        <Link to={`/publicacion/${post.id}`} aria-label="Abrir contenido">
          ↗
        </Link>
      </div>

      <div className="post-actions">
        <button className={liked ? 'liked' : ''} onClick={() => onToggleLike(post.id)} type="button">
          ♡ Reaccionar
        </button>
        <button type="button">◌ Comentar</button>
        <button type="button">↗ Compartir</button>
        <button className="save" type="button">
          🔖
        </button>
      </div>

      <div className="post-stats">
        <span>{post.reactions} reacciones</span>
      </div>

      <p>
        <b>{authorToHandle(post.author)}</b> {post.caption}
      </p>

      <a className="view-comments" href="#comments">
        Ver los {post.comments} comentarios
      </a>
      <time>Actualizado recientemente</time>
    </article>
  )
}

function arePostCardPropsEqual(previousProps, nextProps) {
  return previousProps.post === nextProps.post && previousProps.liked === nextProps.liked
}

export default memo(PostCard, arePostCardPropsEqual)

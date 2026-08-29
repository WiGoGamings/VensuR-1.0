import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { createPostComment, getPostComments } from '../services/postsApi'
import './Pages.css'

function getLocation(meta) {
  const segments = meta.split('·')
  return segments[1]?.trim() ?? 'Venezuela'
}

function isVideoMedia(post) {
  if (typeof post?.mediaUrl !== 'string') return false
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(post.mediaUrl)
}

function isAudioMedia(post) {
  if (typeof post?.mediaUrl !== 'string') return false
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(post.mediaUrl)
}

function formatRelativeTime(value) {
  const timestamp = Date.parse(typeof value === 'string' ? value : '')
  if (!Number.isFinite(timestamp)) return 'Hace un momento'

  const diffMs = Math.max(0, Date.now() - timestamp)
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) return 'Hace un momento'
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `Hace ${diffHours} h`

  const diffDays = Math.floor(diffHours / 24)
  return `Hace ${diffDays} d`
}

/**
 * @param {{
 * posts: import('../data/feedData').Post[],
 * isLoading: boolean
 * }} props
 */
export default function PublicacionPage({ posts, isLoading }) {
  const { postId } = useParams()
  const mediaRef = useRef(null)
  const [isMuted, setIsMuted] = useState(false)
  const [comments, setComments] = useState([])
  const [isCommentsLoading, setIsCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [isCommentSubmitting, setIsCommentSubmitting] = useState(false)

  const post = useMemo(() => {
    if (!posts.length) return null
    if (!postId) return posts[0]

    const byString = posts.find((item) => String(item.id) === String(postId))
    if (byString) return byString

    const numericId = Number(postId)
    if (Number.isNaN(numericId)) return posts[0]

    return posts.find((item) => Number(item.id) === numericId) ?? posts[0]
  }, [posts, postId])

  const hasMediaUrl = Boolean(post?.mediaUrl)
  const isVideo = isVideoMedia(post)
  const isAudio = isAudioMedia(post)
  const hasAudioTrack = isVideo || isAudio

  useEffect(() => {
    const mediaElement = mediaRef.current
    if (!mediaElement) return

    mediaElement.muted = isMuted

    if (!hasAudioTrack) return
    const playAttempt = mediaElement.play?.()

    if (playAttempt && typeof playAttempt.catch === 'function') {
      playAttempt.catch(() => {
        if (!isMuted) {
          setIsMuted(true)
        }
      })
    }
  }, [hasAudioTrack, isMuted, post?.id])

  useEffect(() => {
    if (!post?.id) return

    let isMounted = true

    async function loadComments() {
      setIsCommentsLoading(true)
      try {
        const items = await getPostComments(post.id)
        if (!isMounted) return

        setComments(items)
        setCommentsError('')
      } catch (error) {
        if (!isMounted) return

        setCommentsError(
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar los comentarios de esta publicacion.',
        )
      } finally {
        if (isMounted) {
          setIsCommentsLoading(false)
        }
      }
    }

    void loadComments()

    return () => {
      isMounted = false
    }
  }, [post?.id])

  async function handleCommentSubmit() {
    const text = commentDraft.trim()
    if (!post?.id || !text || isCommentSubmitting) return

    setIsCommentSubmitting(true)
    try {
      const result = await createPostComment(post.id, text)

      if (result.comment) {
        setComments((current) => [result.comment, ...current])
      }

      setCommentDraft('')
      setCommentsError('')
    } catch (error) {
      setCommentsError(
        error instanceof Error
          ? error.message
          : 'No se pudo publicar el comentario en este momento.',
      )
    } finally {
      setIsCommentSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <section className="feed route-page">
        <p className="route-message">Cargando publicacion...</p>
      </section>
    )
  }

  if (!post) {
    return (
      <section className="feed route-page">
        <p className="route-message">No se encontro una publicacion para mostrar.</p>
      </section>
    )
  }

  return (
    <section className="feed route-page post-detail-page">
      <article className="post-detail-wrap">
        <div className={`post-detail-media media-${post.tone}${hasMediaUrl ? '' : ' no-media'}`}>
          {hasMediaUrl ? (
            isVideo ? (
              <video
                autoPlay
                className="post-detail-media-file"
                loop
                muted={isMuted}
                playsInline
                preload="metadata"
                ref={mediaRef}
                src={post.mediaUrl}
              />
            ) : isAudio ? (
              <div className="post-detail-audio-shell">
                <span>{post.media || 'Audio ciudadano'}</span>
                <audio
                  autoPlay
                  className="post-detail-audio-player"
                  loop
                  muted={isMuted}
                  preload="metadata"
                  ref={mediaRef}
                  src={post.mediaUrl}
                />
              </div>
            ) : (
              <img
                alt={post.media || 'Publicacion'}
                className="post-detail-media-file"
                loading="eager"
                src={post.mediaUrl}
              />
            )
          ) : (
            <div className="post-detail-media-empty">
              <p>{post.media || 'Publicacion ciudadana'}</p>
              <small>
                {post.caption
                  ? post.caption
                  : 'Esta publicacion no tiene imagen, video ni audio adjunto.'}
              </small>
            </div>
          )}

          {hasAudioTrack ? (
            <button
              aria-label={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
              className={`post-detail-audio-toggle ${isMuted ? 'muted' : 'unmuted'}`}
              onClick={() => setIsMuted((current) => !current)}
              title={isMuted ? 'Activar sonido' : 'Silenciar sonido'}
              type="button"
            >
              <span className="post-detail-audio-icon" aria-hidden="true">
                <span className="post-detail-audio-waves" />
              </span>
            </button>
          ) : null}

          <div className="post-detail-location">📍 Av. principal, {getLocation(post.meta)}</div>
        </div>

        <div className="post-detail-side">
          <header className="post-detail-head">
            <span className="post-detail-avatar" aria-hidden="true" />
            <div>
              <b>{post.author}</b>
              <div>{post.meta}</div>
            </div>
            <span className={`tag ${post.tagClass}`}>{post.tag}</span>
          </header>

          <p className="post-detail-caption">
            <b>{post.author.toLowerCase().replace(/\s+/g, '_')}</b>
            {post.caption}
          </p>

          <section className="post-detail-comments" aria-label="Comentarios">
            {isCommentsLoading ? (
              <p className="post-detail-comments-note">Cargando comentarios...</p>
            ) : null}

            {!isCommentsLoading && comments.length === 0 ? (
              <p className="post-detail-comments-note">Todavia no hay comentarios en esta publicacion.</p>
            ) : null}

            {comments.map((comment) => (
              <article className="post-detail-comment" key={comment.id}>
                <span className="post-detail-comment-avatar" aria-hidden="true" />
                <div>
                  <p>
                    <b>{comment.handle || comment.author}</b>
                    {comment.text}
                  </p>
                  <small>{formatRelativeTime(comment.createdAt)}</small>
                </div>
              </article>
            ))}
          </section>

          {commentsError ? <p className="post-detail-comments-note error">{commentsError}</p> : null}

          <div className="post-detail-stats">
            {post.reactions} reacciones · {Math.max(Number(post.comments || 0), comments.length)} comentarios
          </div>

          <div className="post-detail-actions" aria-label="Acciones">
            <span>♡</span>
            <span>💬</span>
            <span>↗</span>
            <span>🔖</span>
          </div>

          <div className="post-detail-add-comment">
            <span className="post-detail-comment-avatar" aria-hidden="true" />
            <input
              aria-label="Anade un comentario"
              onChange={(event) => setCommentDraft(event.target.value)}
              placeholder="Anade un comentario..."
              value={commentDraft}
            />
            <button
              disabled={!commentDraft.trim() || isCommentSubmitting}
              onClick={handleCommentSubmit}
              type="button"
            >
              {isCommentSubmitting ? 'Enviando...' : 'Publicar'}
            </button>
          </div>
        </div>
      </article>
    </section>
  )
}

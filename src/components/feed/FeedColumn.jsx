import { memo, useMemo, useState } from 'react'
import Composer from './Composer'
import PostCard from './PostCard'
import StoriesStrip from './StoriesStrip'
import { Link } from 'react-router-dom'
import './FeedColumn.css'

const INITIAL_VISIBLE_POSTS = 14
const POSTS_LOAD_STEP = 12

const FeedPostsList = memo(function FeedPostsList({ posts, likedPostIds, onToggleLike }) {
  return posts.map((post) => (
    <PostCard
      key={post.id}
      post={post}
      liked={likedPostIds.includes(post.id)}
      onToggleLike={onToggleLike}
    />
  ))
})

/**
 * @param {{
 * stories: import('../../data/feedData').StoryItem[],
 * posts: import('../../data/feedData').Post[],
 * isLoading: boolean,
 * errorMessage: string,
 * isAuthenticated: boolean,
 * likedPostIds: Array<string | number>,
 * onToggleLike: (id: string | number) => void
 * }} props
 */
export default function FeedColumn({
  stories,
  posts,
  isLoading,
  errorMessage,
  isAuthenticated,
  likedPostIds,
  onToggleLike,
}) {
  const [visiblePostsCount, setVisiblePostsCount] = useState(INITIAL_VISIBLE_POSTS)
  const [createdPosts, setCreatedPosts] = useState([])

  const mergedPosts = useMemo(() => {
    const sourcePosts = Array.isArray(posts) ? posts : []
    if (!createdPosts.length) {
      return sourcePosts
    }

    const sourceIds = new Set(sourcePosts.map((item) => item.id))
    const recentCreated = createdPosts.filter((item) => !sourceIds.has(item.id))
    return [...recentCreated, ...sourcePosts]
  }, [createdPosts, posts])

  const visiblePosts = useMemo(() => {
    if (!Array.isArray(mergedPosts)) return []
    return mergedPosts.slice(0, Math.max(INITIAL_VISIBLE_POSTS, visiblePostsCount))
  }, [mergedPosts, visiblePostsCount])

  const hasMorePosts = mergedPosts.length > visiblePostsCount

  const onLoadMorePosts = () => {
    setVisiblePostsCount((current) => current + POSTS_LOAD_STEP)
  }

  const onPostCreated = (post) => {
    if (!post) return

    setCreatedPosts((current) => [post, ...current.filter((item) => item.id !== post.id)])
    setVisiblePostsCount((current) => Math.max(current, INITIAL_VISIBLE_POSTS))
  }

  return (
    <section className="feed" id="feed">
      <div className="mobile-heading">
        <span>Tu muro</span>
        <button type="button">⌄</button>
      </div>

      <StoriesStrip stories={stories} />

      <Composer isAuthenticated={isAuthenticated} onPostCreated={onPostCreated} />

      {!isAuthenticated ? (
        <p className="feed-status">
          Inicia sesion para publicar contenido propio. <Link to="/acceso">Entrar o crear cuenta</Link>
        </p>
      ) : null}

      <div className="feed-label">
        <span>Historias y publicaciones</span>
        <button type="button">Mas recientes⌄</button>
      </div>

      {isLoading ? <p className="feed-status">Cargando publicaciones...</p> : null}
      {errorMessage ? <p className="feed-status error">{errorMessage}</p> : null}

      <FeedPostsList posts={visiblePosts} likedPostIds={likedPostIds} onToggleLike={onToggleLike} />

      {hasMorePosts ? (
        <div className="feed-loadmore-wrap">
          <button className="feed-loadmore" onClick={onLoadMorePosts} type="button">
            Cargar mas publicaciones
          </button>
        </div>
      ) : null}
    </section>
  )
}

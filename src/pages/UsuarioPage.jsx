import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { followUser, getUserProfile, unfollowUser } from '../services/usersApi'
import './Pages.css'

function isVideoMedia(post) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(typeof post?.mediaUrl === 'string' ? post.mediaUrl : '')
}

function isAudioMedia(post) {
  return /\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(typeof post?.mediaUrl === 'string' ? post.mediaUrl : '')
}

function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * @param {{
 * posts: import('../data/feedData').Post[],
 * isLoading: boolean
 * }} props
 */
export default function UsuarioPage({ posts, isLoading }) {
  const { username } = useParams()
  const { user: currentUser } = useAuth()
  const [profile, setProfile] = useState(null)
  const [relationship, setRelationship] = useState({
    isSelf: false,
    canFollow: false,
    isFollowing: false,
  })
  const [isProfileLoading, setIsProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [isFollowBusy, setIsFollowBusy] = useState(false)
  const [followError, setFollowError] = useState('')

  const normalizedUsername = normalizeUsername(username)

  useEffect(() => {
    let isMounted = true

    async function loadProfile() {
      if (!normalizedUsername) {
        setProfile(null)
        setRelationship({ isSelf: false, canFollow: false, isFollowing: false })
        setProfileError('Usuario invalido.')
        return
      }

      setIsProfileLoading(true)
      setProfileError('')
      setFollowError('')

      try {
        const response = await getUserProfile(normalizedUsername)
        if (!isMounted) return

        if (!response?.user) {
          setProfile(null)
          setRelationship({ isSelf: false, canFollow: false, isFollowing: false })
          setProfileError('Usuario no encontrado.')
          return
        }

        setProfile(response.user)
        const nextRelationship = response.relationship && typeof response.relationship === 'object'
          ? {
              isSelf: Boolean(response.relationship.isSelf),
              canFollow: Boolean(response.relationship.canFollow),
              isFollowing: Boolean(response.relationship.isFollowing),
            }
          : {
              isSelf: false,
              canFollow: Boolean(currentUser?.id),
              isFollowing: false,
            }

        setRelationship(nextRelationship)
      } catch (error) {
        if (!isMounted) return

        setProfile(null)
        setRelationship({ isSelf: false, canFollow: false, isFollowing: false })
        setProfileError(error instanceof Error ? error.message : 'No se pudo cargar este perfil.')
      } finally {
        if (isMounted) {
          setIsProfileLoading(false)
        }
      }
    }

    loadProfile()

    return () => {
      isMounted = false
    }
  }, [currentUser?.id, normalizedUsername])

  const userPosts = useMemo(() => {
    if (!profile?.id) return []

    return posts
      .filter((post) => post.ownerId === profile.id)
      .slice(0, 24)
  }, [posts, profile])

  const onToggleFollow = async () => {
    if (!profile?.username || relationship.isSelf || !relationship.canFollow || isFollowBusy) return

    setIsFollowBusy(true)
    setFollowError('')

    try {
      const response = relationship.isFollowing
        ? await unfollowUser(profile.username)
        : await followUser(profile.username)

      setRelationship((current) => ({
        isSelf: current.isSelf,
        canFollow: current.canFollow,
        isFollowing: Boolean(response?.relationship?.isFollowing),
      }))

      const nextFollowers = Number(response?.counts?.followers)
      const nextFollowing = Number(response?.counts?.following)

      setProfile((current) => {
        if (!current) return current

        return {
          ...current,
          followersCount: Number.isFinite(nextFollowers) ? nextFollowers : Number(current.followersCount || 0),
          followingCount: Number.isFinite(nextFollowing) ? nextFollowing : Number(current.followingCount || 0),
        }
      })
    } catch (error) {
      setFollowError(error instanceof Error ? error.message : 'No se pudo actualizar el follow en este momento.')
    } finally {
      setIsFollowBusy(false)
    }
  }

  if (isProfileLoading) {
    return (
      <section className="feed route-page user-page">
        <p className="route-message">Cargando perfil publico...</p>
      </section>
    )
  }

  if (profileError) {
    return (
      <section className="feed route-page user-page">
        <p className="route-message error">{profileError}</p>
        <Link className="user-page-back" to="/explorar">
          Volver a explorar
        </Link>
      </section>
    )
  }

  if (!profile) {
    return (
      <section className="feed route-page user-page">
        <p className="route-message">No encontramos el perfil solicitado.</p>
      </section>
    )
  }

  const hasPosts = userPosts.length > 0
  const isPrivate = profile.profileVisibility !== 'public'
  const followersCount = Number(profile.followersCount || 0)
  const followingCount = Number(profile.followingCount || 0)

  return (
    <section className="feed route-page user-page">
      <article className="panel user-public-card">
        <div className="user-public-cover">
          {profile.coverUrl ? (
            <img
              alt={`Portada de ${profile.displayName || profile.username}`}
              className="user-public-cover-img"
              loading="lazy"
              src={profile.coverUrl}
            />
          ) : null}
        </div>

        <div className="user-public-head">
          <div className="user-public-avatar-wrap">
            {profile.avatarUrl ? (
              <img
                alt={`Avatar de ${profile.displayName || profile.username}`}
                className="user-public-avatar"
                loading="lazy"
                src={profile.avatarUrl}
              />
            ) : (
              <span className="user-public-avatar user-public-avatar-fallback" aria-hidden="true">
                {(profile.displayName || profile.username || '?').slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>

          <div className="user-public-main">
            <div className="user-public-title-row">
              <h1>{profile.displayName || profile.username}</h1>
              <span className={`user-public-visibility ${isPrivate ? 'is-private' : 'is-public'}`}>
                {isPrivate ? 'Privado' : 'Publico'}
              </span>
            </div>
            <p className="user-public-handle">@{profile.username}</p>
            <p className="user-public-bio">{profile.bio || 'Este usuario aun no ha agregado biografia.'}</p>

            <div className="user-public-actions">
              {relationship.isSelf ? (
                <Link className="user-follow-btn secondary" to="/perfil">
                  Ir a mi perfil
                </Link>
              ) : currentUser ? (
                <button
                  className={`user-follow-btn ${relationship.isFollowing ? 'is-following' : ''}`}
                  disabled={!relationship.canFollow || isFollowBusy}
                  onClick={onToggleFollow}
                  type="button"
                >
                  {isFollowBusy ? 'Procesando...' : relationship.isFollowing ? 'Dejar de seguir' : 'Seguir'}
                </button>
              ) : (
                <Link className="user-follow-btn secondary" to="/acceso">
                  Entrar para seguir
                </Link>
              )}
            </div>

            {followError ? <p className="route-message error">{followError}</p> : null}

            <div className="user-public-stats">
              <article>
                <b>{userPosts.length}</b>
                <span>Publicaciones visibles</span>
              </article>
              <article>
                <b>{followersCount}</b>
                <span>Seguidores</span>
              </article>
              <article>
                <b>{followingCount}</b>
                <span>Siguiendo</span>
              </article>
            </div>
          </div>
        </div>
      </article>

      {isLoading && !hasPosts ? <p className="route-message">Cargando publicaciones del perfil...</p> : null}

      {!hasPosts ? (
        <p className="route-message">
          {isPrivate
            ? 'Este perfil es privado y no hay publicaciones visibles para ti.'
            : 'Este usuario no tiene publicaciones visibles por ahora.'}
        </p>
      ) : (
        <section className="user-public-posts" aria-label="Publicaciones del usuario">
          {userPosts.map((post) => {
            const isVideo = isVideoMedia(post)
            const isAudio = isAudioMedia(post)
            const detailPath = `/publicacion/${encodeURIComponent(String(post.id))}`

            return (
              <Link className="user-public-post" key={post.id} to={detailPath}>
                <div className="user-public-post-media">
                  {post.mediaUrl ? (
                    isVideo ? (
                      <video className="user-public-post-media-file" muted playsInline preload="metadata" src={post.mediaUrl} />
                    ) : isAudio ? (
                      <div className="user-public-post-audio">Audio</div>
                    ) : (
                      <img alt={post.media || 'Publicacion'} className="user-public-post-media-file" loading="lazy" src={post.mediaUrl} />
                    )
                  ) : (
                    <div className="user-public-post-empty">Sin multimedia</div>
                  )}
                </div>
                <div className="user-public-post-body">
                  <p>{post.caption || 'Publicacion sin texto.'}</p>
                  <small>{post.reactions} reacciones · {post.comments} comentarios</small>
                </div>
              </Link>
            )
          })}
        </section>
      )}
    </section>
  )
}

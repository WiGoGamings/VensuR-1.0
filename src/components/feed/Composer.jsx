import './Composer.css'
import { Suspense, lazy, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useLiveBroadcast } from '../../contexts/LiveBroadcastContext'
import { createStory } from '../../services/storiesApi'

const StoryStudio = lazy(() => import('../composer/StoryStudio'))
const PostComposer = lazy(() => import('../composer/PostComposer'))

// Precarga silenciosa al acercar el cursor, para que el editor abra al instante.
const prefetchStory = () => {
  void import('../composer/StoryStudio')
}
const prefetchPost = () => {
  void import('../composer/PostComposer')
}
const prefetchLive = () => {
  void import('../live/LiveOverlays')
}

function initialsOf(user) {
  const source = user?.displayName || user?.username || 'VR'
  return source.slice(0, 2).toUpperCase()
}

/**
 * @param {{
 * isAuthenticated: boolean,
 * onPostCreated?: (post: import('../../data/feedData').Post) => void
 * }} props
 */
export default function Composer({ isAuthenticated, onPostCreated }) {
  const { user } = useAuth()
  const { isLive, openStudio: openLiveStudio, openMonitor: openLiveMonitor } = useLiveBroadcast()

  const [isPostComposerOpen, setIsPostComposerOpen] = useState(false)
  const [isStoryStudioOpen, setIsStoryStudioOpen] = useState(false)
  const [composerError, setComposerError] = useState('')
  const [composerStatus, setComposerStatus] = useState('')

  const avatarText = useMemo(() => initialsOf(user), [user])

  const promptName = useMemo(() => {
    const source = user?.displayName || user?.username || ''
    if (!source) return 'Comunidad'
    const firstName = source.trim().split(/\s+/)[0] || source
    return firstName.slice(0, 18)
  }, [user?.displayName, user?.username])

  const openCreator = (type) => {
    if (!isAuthenticated) {
      setComposerError('Debes iniciar sesión para crear contenido desde Inicio.')
      return
    }

    setComposerError('')
    setComposerStatus('')

    if (type === 'story') {
      setIsStoryStudioOpen(true)
    } else if (type === 'live') {
      if (isLive) openLiveMonitor()
      else openLiveStudio()
    } else {
      setIsPostComposerOpen(true)
    }
  }

  const publishStoryFromStudio = async ({ mediaFile, title, description, metadata }) => {
    try {
      const response = await createStory({
        title: title || 'Historia',
        description: description || '',
        mediaFile,
        metadata,
      })
      if (!response?.story) return false
      setComposerStatus('Historia publicada correctamente.')
      return true
    } catch {
      return false
    }
  }

  return (
    <>
      <section className="composer composer-compact" aria-label="Crear contenido rapido">
        <div className="avatar user-avatar">
          {user?.avatarUrl ? (
            <img alt="" aria-hidden="true" className="composer-avatar-img" loading="lazy" src={user.avatarUrl} />
          ) : (
            avatarText
          )}
        </div>

        <div className="composer-compact-body">
          <button
            className="composer-prompt"
            onClick={() => openCreator('post')}
            onMouseEnter={prefetchPost}
            type="button"
          >
            {isAuthenticated ? `Que estas pensando, ${promptName}?` : 'Inicia sesion para crear contenido'}
          </button>

          <div className="composer-quick-actions" aria-label="Accesos directos de creacion">
            <button className="composer-quick-btn story" onClick={() => openCreator('story')} onMouseEnter={prefetchStory} title="Crear historia" type="button">
              ◉
            </button>
            <button className="composer-quick-btn post" onClick={() => openCreator('post')} onMouseEnter={prefetchPost} title="Crear publicacion" type="button">
              ▣
            </button>
            <button
              className={`composer-quick-btn live ${isLive ? 'is-live' : ''}`}
              onClick={() => openCreator('live')}
              onMouseEnter={prefetchLive}
              title={isLive ? 'Ver tu transmisión' : 'Crear en vivo'}
              type="button"
            >
              ●
            </button>
          </div>
        </div>
      </section>

      {composerStatus ? <p className="composer-feedback success">{composerStatus}</p> : null}
      {composerError ? <p className="composer-feedback error">{composerError}</p> : null}
      {!isAuthenticated ? (
        <p className="composer-feedback">
          Para crear contenido desde Inicio, entra con tu cuenta. <Link to="/acceso">Ir a acceso</Link>
        </p>
      ) : null}

      {isPostComposerOpen || isStoryStudioOpen ? (
        <Suspense fallback={<div className="composer-loading-overlay">Abriendo el editor…</div>}>
          {isPostComposerOpen ? (
            <PostComposer
              user={user}
              onClose={() => setIsPostComposerOpen(false)}
              onCreated={(post) => {
                onPostCreated?.(post)
                setComposerStatus('Publicación creada correctamente.')
              }}
            />
          ) : null}

          {isStoryStudioOpen ? (
            <StoryStudio
              user={user}
              mode="story"
              onClose={() => setIsStoryStudioOpen(false)}
              onPublish={publishStoryFromStudio}
            />
          ) : null}
        </Suspense>
      ) : null}
    </>
  )
}

import './Composer.css'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useLiveBroadcast } from '../../contexts/LiveBroadcastContext'
import { createStory } from '../../services/storiesApi'
import StoryStudio from '../composer/StoryStudio'
import PostComposer from '../composer/PostComposer'

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
          <button className="composer-prompt" onClick={() => openCreator('post')} type="button">
            {isAuthenticated ? `Que estas pensando, ${promptName}?` : 'Inicia sesion para crear contenido'}
          </button>

          <div className="composer-quick-actions" aria-label="Accesos directos de creacion">
            <button className="composer-quick-btn story" onClick={() => openCreator('story')} title="Crear historia" type="button">
              ◉
            </button>
            <button className="composer-quick-btn post" onClick={() => openCreator('post')} title="Crear publicacion" type="button">
              ▣
            </button>
            <button
              className={`composer-quick-btn live ${isLive ? 'is-live' : ''}`}
              onClick={() => openCreator('live')}
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
    </>
  )
}

import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { searchUsers } from '../services/usersApi'
import './Pages.css'

const sections = [
  { id: 'mapa', title: 'Mapa ciudadano', text: 'Seguimiento de reportes por estado y municipio.' },
  { id: 'analisis', title: 'Analisis de contexto', text: 'Tendencias semanales sobre servicios, precios y movilidad.' },
  { id: 'historias', title: 'Historias locales', text: 'Testimonios y memoria social con enfoque territorial.' },
  { id: 'foros', title: 'Foros abiertos', text: 'Debates por comunidad para acciones coordinadas.' },
]

export default function ExplorarPage() {
  const [searchParams] = useSearchParams()
  const searchQuery = (searchParams.get('q') || '').trim()
  const [users, setUsers] = useState([])
  const [usersError, setUsersError] = useState('')
  const [isUsersLoading, setIsUsersLoading] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadUsers() {
      if (searchQuery.length < 2) {
        setIsUsersLoading(false)
        setUsers([])
        setUsersError(searchQuery ? 'Escribe al menos 2 caracteres para buscar usuarios.' : '')
        return
      }

      setIsUsersLoading(true)
      setUsersError('')

      try {
        const response = await searchUsers(searchQuery, 24)
        if (!isMounted) return

        setUsers(Array.isArray(response.items) ? response.items : [])
      } catch (error) {
        if (!isMounted) return

        setUsers([])
        setUsersError(error instanceof Error ? error.message : 'No se pudo buscar usuarios.')
      } finally {
        if (isMounted) {
          setIsUsersLoading(false)
        }
      }
    }

    loadUsers()

    return () => {
      isMounted = false
    }
  }, [searchQuery])

  const hasSearchQuery = Boolean(searchQuery)

  const renderUserAvatar = (user) => {
    if (user?.avatarUrl) {
      return (
        <img
          alt={`Avatar de ${user.displayName || user.username}`}
          className="explore-user-avatar"
          loading="lazy"
          src={user.avatarUrl}
        />
      )
    }

    const fallbackText = (user?.displayName || user?.username || '?').slice(0, 1).toUpperCase()
    return <span className="explore-user-avatar-fallback" aria-hidden="true">{fallbackText}</span>
  }

  return (
    <section className="feed route-page">
      <header className="route-header">
        <h1>Explorar</h1>
        <p>
          {hasSearchQuery
            ? `Resultados de usuarios para "${searchQuery}".`
            : 'Descubre temas, comunidades y visualizaciones de la realidad ciudadana.'}
        </p>
      </header>

      {hasSearchQuery ? (
        <section className="panel explore-users-panel" aria-label="Resultados de usuarios">
          <div className="explore-users-head">
            <h2>Usuarios</h2>
            <small>{isUsersLoading ? 'Buscando...' : `${users.length} encontrados`}</small>
          </div>

          {usersError ? <p className="route-message error">{usersError}</p> : null}

          {isUsersLoading ? <p className="route-message">Buscando usuarios en la base de datos...</p> : null}

          {!isUsersLoading && !usersError && users.length ? (
            <div className="explore-users-list">
              {users.map((user) => (
                <Link
                  className="explore-user-link"
                  key={user.id}
                  to={`/usuario/${encodeURIComponent(user.username)}`}
                >
                  <article className="explore-user-card panel">
                    <div className="explore-user-avatar-wrap">{renderUserAvatar(user)}</div>

                    <div className="explore-user-body">
                      <h3>{user.displayName || user.username}</h3>
                      <p className="explore-user-handle">@{user.username}</p>
                      <p className="explore-user-bio">{user.bio || 'Sin biografia publica.'}</p>
                    </div>

                    <span
                      className={`explore-user-visibility ${user.profileVisibility === 'public' ? 'is-public' : 'is-private'}`}
                    >
                      {user.profileVisibility === 'public' ? 'Seguir' : 'Privado'}
                    </span>
                  </article>
                </Link>
              ))}
            </div>
          ) : null}

          {!isUsersLoading && !usersError && !users.length ? (
            <p className="route-message">No encontramos usuarios con ese criterio de busqueda.</p>
          ) : null}
        </section>
      ) : (
        <p className="route-message">Escribe en la barra de busqueda para encontrar usuarios guardados.</p>
      )}

      <div className="route-grid">
        {sections.map((section) => (
          <article className={`route-card ${section.id}`} key={section.id}>
            <h2>{section.title}</h2>
            <p>{section.text}</p>
            <button type="button">Abrir modulo</button>
          </article>
        ))}
      </div>
    </section>
  )
}

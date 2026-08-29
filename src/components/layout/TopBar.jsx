import './TopBar.css'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { memo, useEffect, useState } from 'react'

function readSearchQuery(search) {
  const params = new URLSearchParams(search)
  return (params.get('q') || '').slice(0, 80)
}

const TOP_NAV_ALLOWED_PATHS = new Set(['/', '/perfil'])
const TOP_NAV_ICONS = {
  '/': '⌂',
}

/**
 * @param {{
 * links: import('../../data/feedData').TopLink[],
 * currentUser: null | {
 * id: string,
 * username: string,
 * displayName: string,
 * avatarUrl?: string
 * },
 * onLogout: () => void | Promise<boolean>
 * }} props
 */
export default memo(function TopBar({ links, currentUser, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchValue, setSearchValue] = useState(() => readSearchQuery(location.search))
  const topNavLinks = links.filter((link) => TOP_NAV_ALLOWED_PATHS.has(link.path))

  useEffect(() => {
    if (location.pathname.startsWith('/explorar')) {
      setSearchValue(readSearchQuery(location.search))
    }
  }, [location.pathname, location.search])

  const onSearchSubmit = (event) => {
    event.preventDefault()

    const query = searchValue.trim()
    if (!query) {
      navigate('/explorar')
      return
    }

    navigate(`/explorar?q=${encodeURIComponent(query)}`)
  }

  const onSearchFocus = () => {
    if (!location.pathname.startsWith('/explorar')) {
      navigate('/explorar')
    }
  }

  return (
    <header className="topbar">
      <Link className="brand" to="/" aria-label="Venezuela en su realidad, inicio">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>
          VENEZUELA <em>EN SU REALIDAD</em>
        </span>
      </Link>

      <form className="search" onSubmit={onSearchSubmit} role="search" aria-label="Buscar usuarios">
        <span aria-hidden="true">⌕</span>
        <input
          aria-label="Buscar usuarios"
          maxLength={80}
          onChange={(event) => setSearchValue(event.target.value)}
          onFocus={onSearchFocus}
          placeholder="Buscar usuarios por nombre, @usuario o correo"
          value={searchValue}
        />
      </form>

      <nav className="top-links" aria-label="Navegación superior">
        {topNavLinks.map((link) => (
          <NavLink
            key={link.label}
            to={link.path}
            end={link.path === '/'}
            aria-label={link.label}
            title={link.label}
          >
            {link.path === '/perfil' ? (
              currentUser?.avatarUrl ? (
                <img
                  alt=""
                  aria-hidden="true"
                  className="top-link-avatar"
                  loading="lazy"
                  src={currentUser.avatarUrl}
                />
              ) : (
                <span className="top-link-icon top-link-profile-fallback" aria-hidden="true">◉</span>
              )
            ) : TOP_NAV_ICONS[link.path] ? (
              <span className="top-link-icon" aria-hidden="true">{TOP_NAV_ICONS[link.path]}</span>
            ) : link.label}
            {link.badge ? <b>{link.badge}</b> : null}
          </NavLink>
        ))}
      </nav>

      <div className="topbar-session" aria-label="Estado de sesion">
        {currentUser ? (
          <>
            <Link className="session-user" to="/perfil">
              @{currentUser.username}
            </Link>
            <button className="session-action" onClick={onLogout} type="button">
              Salir
            </button>
          </>
        ) : (
          <Link className="session-action" to="/acceso">
            Entrar
          </Link>
        )}
      </div>

      <button className="mobile-menu" type="button" aria-label="Abrir menu">
        ☰
      </button>
    </header>
  )
})

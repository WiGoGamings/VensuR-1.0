import './TopBar.css'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { memo, useEffect, useRef, useState } from 'react'

function readSearchQuery(search) {
  const params = new URLSearchParams(search)
  return (params.get('q') || '').slice(0, 80)
}

const TOP_NAV_ALLOWED_PATHS = new Set(['/', '/perfil'])
const TOP_NAV_ICONS = {
  '/': '⌂',
}

function compactBadge(total) {
  const count = Number(total || 0)
  if (!Number.isFinite(count) || count <= 0) return ''
  return count > 99 ? '99+' : String(count)
}

function formatNotificationTime(value) {
  const ts = Date.parse(typeof value === 'string' ? value : '')
  if (!Number.isFinite(ts)) return 'hace un momento'

  const diffMs = Math.max(0, Date.now() - ts)
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return 'hace un momento'
  if (diffMin < 60) return `hace ${diffMin} min`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `hace ${diffHours} h`

  const diffDays = Math.floor(diffHours / 24)
  return `hace ${diffDays} d`
}

function describeNotification(item) {
  if (item?.type === 'live_started') return 'Inició una transmisión en vivo.'
  if (item?.type === 'story_published') return 'Subió una historia nueva.'
  if (item?.type === 'post_published') return 'Publicó una nueva actualización.'
  return 'Hay actividad nueva en una cuenta que sigues.'
}

function iconForNotification(type) {
  if (type === 'live_started') return '▶'
  if (type === 'story_published') return '◉'
  if (type === 'post_published') return '✦'
  return '•'
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
 * onLogout: () => void | Promise<boolean>,
 * notifications?: Array<any>,
 * unreadNotifications?: number,
 * isNotificationsLoading?: boolean,
 * notificationsError?: string,
 * onRefreshNotifications?: (options?: { silent?: boolean }) => Promise<void> | void,
 * onMarkAllNotificationsRead?: () => Promise<void> | void
 * }} props
 */
export default memo(function TopBar({
  links,
  currentUser,
  onLogout,
  notifications = [],
  unreadNotifications = 0,
  isNotificationsLoading = false,
  notificationsError = '',
  onRefreshNotifications,
  onMarkAllNotificationsRead,
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchValue, setSearchValue] = useState(() => readSearchQuery(location.search))
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const notificationsRootRef = useRef(null)
  const topNavLinks = links.filter((link) => TOP_NAV_ALLOWED_PATHS.has(link.path))
  const unreadBadge = compactBadge(unreadNotifications)

  useEffect(() => {
    if (location.pathname.startsWith('/explorar')) {
      setSearchValue(readSearchQuery(location.search))
    }
  }, [location.pathname, location.search])

  // Cierra el menú móvil al navegar o al pulsar Escape.
  useEffect(() => {
    setIsMenuOpen(false)
    setIsNotificationsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!isMenuOpen && !isNotificationsOpen) return undefined
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      setIsMenuOpen(false)
      setIsNotificationsOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isMenuOpen, isNotificationsOpen])

  useEffect(() => {
    if (!isNotificationsOpen) return undefined

    const onPointerDown = (event) => {
      if (notificationsRootRef.current?.contains(event.target)) return
      setIsNotificationsOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isNotificationsOpen])

  useEffect(() => {
    if (!isNotificationsOpen || !currentUser?.id || unreadNotifications <= 0 || !onMarkAllNotificationsRead) {
      return undefined
    }

    const timerId = setTimeout(() => {
      void onMarkAllNotificationsRead()
    }, 650)

    return () => clearTimeout(timerId)
  }, [currentUser?.id, isNotificationsOpen, onMarkAllNotificationsRead, unreadNotifications])

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
    <>
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
            <div className="topbar-notifications" ref={notificationsRootRef}>
              <button
                aria-expanded={isNotificationsOpen}
                aria-label="Notificaciones"
                className={`notifications-toggle ${unreadBadge ? 'has-unread' : ''}`.trim()}
                onClick={() => {
                  const nextOpen = !isNotificationsOpen
                  setIsNotificationsOpen(nextOpen)
                  if (nextOpen && onRefreshNotifications) {
                    void onRefreshNotifications({ silent: true })
                  }
                }}
                type="button"
              >
                <span aria-hidden="true">🔔</span>
                {unreadBadge ? <b>{unreadBadge}</b> : null}
              </button>

              {isNotificationsOpen ? (
                <section className="notifications-popover" aria-label="Notificaciones de actividad">
                  <div className="notifications-head">
                    <strong>Notificaciones</strong>
                    <button
                      className="notifications-refresh"
                      onClick={() => void onRefreshNotifications?.({ silent: false })}
                      type="button"
                    >
                      Actualizar
                    </button>
                  </div>

                  {notificationsError ? <p className="notifications-error">{notificationsError}</p> : null}

                  <div className="notifications-list">
                    {isNotificationsLoading && notifications.length === 0 ? (
                      <p className="notifications-empty">Cargando notificaciones...</p>
                    ) : null}

                    {!isNotificationsLoading && notifications.length === 0 ? (
                      <p className="notifications-empty">No hay notificaciones nuevas por ahora.</p>
                    ) : null}

                    {notifications.map((item) => (
                      <Link
                        className={`notifications-item ${item.read ? '' : 'is-unread'}`.trim()}
                        key={item.id || `${item.type}-${item.createdAt}`}
                        onClick={() => setIsNotificationsOpen(false)}
                        to={item.targetPath || '/vivo'}
                      >
                        <span className="notifications-item-icon" aria-hidden="true">{iconForNotification(item.type)}</span>
                        <span className="notifications-item-copy">
                          <b>{item.title || 'Nueva actividad'}</b>
                          <small>{item.message || describeNotification(item)}</small>
                          <time>{formatNotificationTime(item.createdAt)}</time>
                        </span>
                        {!item.read ? <i className="notifications-item-dot" aria-hidden="true" /> : null}
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

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

      <button
        aria-expanded={isMenuOpen}
        aria-label={isMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
        className="mobile-menu"
        onClick={() => setIsMenuOpen((open) => !open)}
        type="button"
      >
        {isMenuOpen ? '✕' : '☰'}
      </button>
    </header>

      {isMenuOpen ? (
        <div className="mobile-nav-backdrop" onClick={() => setIsMenuOpen(false)}>
          <nav
            className="mobile-nav-drawer"
            aria-label="Menú de navegación"
            onClick={(event) => event.stopPropagation()}
          >
            {currentUser ? (
              <div className="mobile-nav-user">
                {currentUser.avatarUrl ? (
                  <img alt="" className="mobile-nav-avatar" src={currentUser.avatarUrl} />
                ) : (
                  <span className="mobile-nav-avatar fallback">
                    {(currentUser.displayName || currentUser.username || 'VE').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div>
                  <b>{currentUser.displayName || currentUser.username}</b>
                  <small>@{currentUser.username}</small>
                </div>
              </div>
            ) : null}

            <div className="mobile-nav-links">
              {links.map((link) => (
                <NavLink
                  className={({ isActive }) => (isActive ? 'active' : '')}
                  end={link.path === '/'}
                  key={link.label}
                  to={link.path}
                >
                  {link.label}
                  {link.badge ? <b>{link.badge}</b> : null}
                </NavLink>
              ))}
            </div>

            {currentUser ? (
              <button
                className="mobile-nav-logout"
                onClick={() => {
                  setIsMenuOpen(false)
                  onLogout?.()
                }}
                type="button"
              >
                Cerrar sesión
              </button>
            ) : (
              <Link className="mobile-nav-logout" to="/acceso">
                Entrar o crear cuenta
              </Link>
            )}
          </nav>
        </div>
      ) : null}
    </>
  )
})

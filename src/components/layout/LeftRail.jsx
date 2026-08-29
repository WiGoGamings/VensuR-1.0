import './LeftRail.css'
import { memo, useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { getUserProfile } from '../../services/usersApi'

function readPublicUsername(pathname) {
  const normalizedPathname = typeof pathname === 'string' ? pathname : ''
  const match = /^\/usuario\/([^/]+)/i.exec(normalizedPathname)
  if (!match) return ''

  try {
    return decodeURIComponent(match[1]).trim().toLowerCase()
  } catch {
    return String(match[1]).trim().toLowerCase()
  }
}

/**
 * @param {{
 * items: import('../../data/feedData').NavItem[],
 * }} props
 */
function AccessList({ items }) {
  return (
    <section className="side-card">
      <h2>Accesos</h2>
      <nav className="nav-list">
        {items.map((item) => (
          <NavLink
            key={item.label}
            to={item.path}
            end={item.path === '/'}
            aria-label={item.label}
            title={item.label}
            data-label={item.label}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            <small>{item.count}</small>
            <span className="nav-tooltip" aria-hidden="true">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </section>
  )
}

/**
 * @param {{ links: import('../../data/feedData').ActivityLink[] }} props
 */
function ActivityList({ links }) {
  return (
    <section className="side-card activity-card">
      <h2>Tu actividad</h2>
      {links.map((item) => (
        <a href={item.href} key={item.label} aria-label={item.label} title={item.label}>
          <span>{item.icon}</span>
          {item.label}
        </a>
      ))}
    </section>
  )
}

/**
 * @param {{
 * items: import('../../data/feedData').NavItem[],
 * activityLinks: import('../../data/feedData').ActivityLink[],
 * currentUser?: null | {
 * id: string,
 * username: string,
 * displayName: string,
 * avatarUrl?: string
 * },
 * }} props
 */
export default memo(function LeftRail({ items, activityLinks, currentUser }) {
  const location = useLocation()
  const publicUsername = useMemo(() => readPublicUsername(location.pathname), [location.pathname])
  const [publicProfilePreview, setPublicProfilePreview] = useState({ username: '', avatarUrl: '' })

  useEffect(() => {
    let isMounted = true

    async function loadPublicAvatar() {
      const hasCurrentUserAvatar =
        typeof currentUser?.avatarUrl === 'string' && currentUser.avatarUrl.length > 0

      if (hasCurrentUserAvatar || !publicUsername) {
        return
      }

      try {
        const response = await getUserProfile(publicUsername)
        if (!isMounted) return

        const avatarUrl =
          typeof response?.user?.avatarUrl === 'string' ? response.user.avatarUrl : ''
        setPublicProfilePreview({ username: publicUsername, avatarUrl })
      } catch {
        if (!isMounted) return
        setPublicProfilePreview({ username: publicUsername, avatarUrl: '' })
      }
    }

    loadPublicAvatar()

    return () => {
      isMounted = false
    }
  }, [currentUser?.avatarUrl, publicUsername])

  const profileTarget = currentUser?.id
    ? '/perfil'
    : publicUsername
      ? `/usuario/${encodeURIComponent(publicUsername)}`
      : '/perfil'
  const publicAvatarUrl =
    publicProfilePreview.username === publicUsername ? publicProfilePreview.avatarUrl : ''
  const avatarUrl =
    typeof currentUser?.avatarUrl === 'string' && currentUser.avatarUrl
      ? currentUser.avatarUrl
      : publicAvatarUrl
  const profileLabel = currentUser?.displayName
    ? `Perfil de ${currentUser.displayName}`
    : publicUsername
      ? `Perfil de @${publicUsername}`
      : 'Perfil'
  const hasAvatar = typeof avatarUrl === 'string' && avatarUrl.length > 0
  const fallbackText =
    (currentUser?.displayName || currentUser?.username || publicUsername || 'VE').slice(0, 1).toUpperCase()

  return (
    <aside className="sidebar" aria-label="Navegación principal">
      <NavLink
        className="sidebar-user-badge"
        to={profileTarget}
        aria-label={profileLabel}
        title={profileLabel}
        data-label={profileLabel}
      >
        {hasAvatar ? (
          <img alt="" aria-hidden="true" className="sidebar-user-avatar" loading="lazy" src={avatarUrl} />
        ) : (
          <span className="sidebar-user-fallback" aria-hidden="true">{fallbackText}</span>
        )}
        <span className="nav-tooltip" aria-hidden="true">{profileLabel}</span>
      </NavLink>

      <AccessList items={items} />
      <ActivityList links={activityLinks} />
      <p className="sidebar-note">Un espacio para mirar, recordar y participar.</p>
    </aside>
  )
})

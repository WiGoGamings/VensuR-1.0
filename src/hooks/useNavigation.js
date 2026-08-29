import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'vensur.activeNav'

/** @typedef {import('../data/feedData').NavItem} NavItem */

/**
 * @param {NavItem[]} items
 * @returns {{
 * activeNav: string,
 * setActiveNav: (label: string) => void
 * }}
 */
export default function useNavigation(items) {
  const fallback = items[0]?.label ?? ''

  const [activeNav, setActiveNav] = useState(() => {
    if (typeof window === 'undefined') return fallback

    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return fallback

    const exists = items.some((item) => item.label === saved)
    return exists ? saved : fallback
  })

  const resolvedActiveNav = items.some((item) => item.label === activeNav)
    ? activeNav
    : fallback

  const selectNav = useCallback(
    (label) => {
      const exists = items.some((item) => item.label === label)
      setActiveNav(exists ? label : fallback)
    },
    [items, fallback],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!resolvedActiveNav) return

    window.localStorage.setItem(STORAGE_KEY, resolvedActiveNav)
  }, [resolvedActiveNav])

  return { activeNav: resolvedActiveNav, setActiveNav: selectNav }
}

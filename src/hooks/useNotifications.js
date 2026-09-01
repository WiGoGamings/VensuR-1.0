import { useCallback, useEffect, useState } from 'react'
import { getMyNotifications, markNotificationsRead } from '../services/notificationsApi'

const NOTIFICATIONS_POLL_INTERVAL_MS = 16_000
const NOTIFICATIONS_LIMIT = 24

export default function useNotifications({ isAuthenticated, enabled = true }) {
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const refreshNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!enabled || !isAuthenticated) {
      setItems([])
      setUnreadCount(0)
      setErrorMessage('')
      return
    }

    if (!silent) setIsLoading(true)

    try {
      const payload = await getMyNotifications(NOTIFICATIONS_LIMIT)
      setItems(Array.isArray(payload.items) ? payload.items : [])
      setUnreadCount(Number.isFinite(Number(payload.unread)) ? Number(payload.unread) : 0)
      setErrorMessage('')
    } catch (error) {
      if (!silent) {
        setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar las notificaciones.')
      }
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [enabled, isAuthenticated])

  const markAllAsRead = useCallback(async () => {
    if (!isAuthenticated || unreadCount <= 0) return

    const optimisticAt = new Date().toISOString()
    setUnreadCount(0)
    setItems((current) => current.map((item) => ({ ...item, read: true, readAt: item.readAt || optimisticAt })))

    try {
      const payload = await markNotificationsRead()
      setUnreadCount(Number.isFinite(Number(payload.unread)) ? Number(payload.unread) : 0)
    } catch {
      await refreshNotifications({ silent: true })
    }
  }, [isAuthenticated, refreshNotifications, unreadCount])

  useEffect(() => {
    if (!enabled || !isAuthenticated) return undefined

    let mounted = true

    const pump = async (silent) => {
      if (!mounted) return
      await refreshNotifications({ silent })
    }

    void pump(false)
    const timerId = setInterval(() => {
      void pump(true)
    }, NOTIFICATIONS_POLL_INTERVAL_MS)

    return () => {
      mounted = false
      clearInterval(timerId)
    }
  }, [enabled, isAuthenticated, refreshNotifications])

  const effectiveItems = enabled && isAuthenticated ? items : []
  const effectiveUnreadCount = enabled && isAuthenticated ? unreadCount : 0
  const effectiveErrorMessage = enabled && isAuthenticated ? errorMessage : ''

  return {
    notifications: effectiveItems,
    unreadCount: effectiveUnreadCount,
    isLoading,
    errorMessage: effectiveErrorMessage,
    refreshNotifications,
    markAllAsRead,
  }
}

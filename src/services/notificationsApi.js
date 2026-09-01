import { httpRequest } from './httpClient'

function clampLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return 24
  return Math.max(1, Math.min(80, parsed))
}

function normalizeNotification(item) {
  return {
    id: typeof item?.id === 'string' ? item.id : '',
    type: typeof item?.type === 'string' ? item.type : '',
    entityId: typeof item?.entityId === 'string' ? item.entityId : '',
    title: typeof item?.title === 'string' ? item.title : 'Nueva actividad',
    message: typeof item?.message === 'string' ? item.message : '',
    read: Boolean(item?.read),
    readAt: typeof item?.readAt === 'string' ? item.readAt : '',
    createdAt: typeof item?.createdAt === 'string' ? item.createdAt : '',
    targetPath: typeof item?.targetPath === 'string' && item.targetPath.startsWith('/')
      ? item.targetPath
      : '/vivo',
    actor: {
      id: typeof item?.actor?.id === 'string' ? item.actor.id : '',
      username: typeof item?.actor?.username === 'string' ? item.actor.username : '',
      displayName: typeof item?.actor?.displayName === 'string' ? item.actor.displayName : '',
      avatarUrl: typeof item?.actor?.avatarUrl === 'string' ? item.actor.avatarUrl : '',
    },
  }
}

/**
 * @param {number} [limit]
 * @returns {Promise<{ unread: number, items: Array<any> }>}
 */
export async function getMyNotifications(limit = 24) {
  const payload = await httpRequest(`/api/content/me/notifications?limit=${clampLimit(limit)}`)

  return {
    unread: Number(payload?.unread ?? 0),
    items: Array.isArray(payload?.items) ? payload.items.map(normalizeNotification) : [],
  }
}

/**
 * @param {Array<string>} [ids]
 * @returns {Promise<{ ok: boolean, unread: number }>}
 */
export async function markNotificationsRead(ids = []) {
  const normalizedIds = Array.isArray(ids)
    ? ids.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 80)
    : []

  const payload = await httpRequest('/api/content/me/notifications/read', {
    method: 'POST',
    body: { ids: normalizedIds },
  })

  return {
    ok: Boolean(payload?.ok),
    unread: Number(payload?.unread ?? 0),
  }
}

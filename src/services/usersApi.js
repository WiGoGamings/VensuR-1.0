import { httpRequest } from './httpClient'

/**
 * @param {string} query
 * @param {number} [limit]
 */
export function searchUsers(query, limit = 24) {
  const params = new URLSearchParams()
  const normalizedQuery = typeof query === 'string' ? query.trim() : ''

  if (normalizedQuery) {
    params.set('q', normalizedQuery)
  }

  params.set('limit', String(limit))
  return httpRequest(`/api/content/users/search?${params.toString()}`)
}

/**
 * @param {string} username
 */
export function getUserProfile(username) {
  return httpRequest(`/api/content/users/${encodeURIComponent(String(username || '').trim())}`)
}

/**
 * @param {string} username
 */
export function followUser(username) {
  return httpRequest(`/api/content/users/${encodeURIComponent(String(username || '').trim())}/follow`, {
    method: 'POST',
  })
}

/**
 * @param {string} username
 */
export function unfollowUser(username) {
  return httpRequest(`/api/content/users/${encodeURIComponent(String(username || '').trim())}/follow`, {
    method: 'DELETE',
  })
}

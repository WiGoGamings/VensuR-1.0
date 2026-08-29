import { httpRequest } from './httpClient'

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toEncoded(value) {
  return encodeURIComponent(normalizeId(value))
}

/**
 * @returns {Promise<{ total: number, items: Array<any> }>}
 */
export function listFollowingLiveSessions() {
  return httpRequest('/api/content/live/sessions/following')
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ session: any }>} 
 */
export function getLiveSession(sessionId) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}`)
}

/**
 * @param {{ title: string, description?: string }} payload
 * @returns {Promise<{ session: any, sharePath: string }>}
 */
export function createLiveSession(payload) {
  return httpRequest('/api/content/live/sessions', {
    method: 'POST',
    body: payload,
  })
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ ok: boolean, session: any }>} 
 */
export function stopLiveSession(sessionId) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/stop`, {
    method: 'POST',
  })
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ items: Array<any>, viewerCount: number }>}
 */
export function getLiveSessionOffers(sessionId) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/offers`)
}

/**
 * @param {string} sessionId
 * @param {{ type: string, sdp: string }} offer
 * @returns {Promise<{ viewerId: string, pollAfterMs: number }>}
 */
export function submitLiveViewerOffer(sessionId, offer) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/viewers/offer`, {
    method: 'POST',
    body: { offer },
  })
}

/**
 * @param {string} sessionId
 * @param {string} viewerId
 * @param {{ type: string, sdp: string }} answer
 * @returns {Promise<{ ok: boolean, viewerCount: number }>}
 */
export function submitLiveViewerAnswer(sessionId, viewerId, answer) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/viewers/${toEncoded(viewerId)}/answer`, {
    method: 'POST',
    body: { answer },
  })
}

/**
 * @param {string} sessionId
 * @param {string} viewerId
 * @returns {Promise<{ ready: boolean, ended?: boolean, pending?: boolean, answer?: any, viewerCount?: number }>}
 */
export function getLiveViewerAnswer(sessionId, viewerId) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/viewers/${toEncoded(viewerId)}/answer`)
}

/**
 * @param {string} sessionId
 * @param {string} viewerId
 * @returns {Promise<{ ok: boolean, viewerCount: number }>}
 */
export function leaveLiveViewer(sessionId, viewerId) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/viewers/${toEncoded(viewerId)}`, {
    method: 'DELETE',
  })
}

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
export function listLiveSessions() {
  return httpRequest('/api/content/live/sessions')
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

/**
 * Estado de la sala en vivo (chat efímero + likes acumulados).
 * @param {string} sessionId
 * @param {number} [sinceSeq] Solo devuelve mensajes con seq mayor a este.
 * @returns {Promise<{ session: any, ended: boolean, likes: number, viewerCount: number, chat: Array<any>, latestSeq: number }>}
 */
export function getLiveRoom(sessionId, sinceSeq = 0) {
  const query = sinceSeq > 0 ? `?sinceSeq=${encodeURIComponent(String(sinceSeq))}` : ''
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/room${query}`)
}

/**
 * @param {string} sessionId
 * @param {string} text
 * @returns {Promise<{ message: any, likes: number, viewerCount: number }>}
 */
export function sendLiveChatMessage(sessionId, text) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/chat`, {
    method: 'POST',
    body: { text },
  })
}

/**
 * @param {string} sessionId
 * @param {number} count Cantidad de likes a sumar (se limita en el servidor).
 * @returns {Promise<{ likes: number, viewerCount: number }>}
 */
export function sendLiveLikes(sessionId, count = 1) {
  return httpRequest(`/api/content/live/sessions/${toEncoded(sessionId)}/likes`, {
    method: 'POST',
    body: { count },
  })
}

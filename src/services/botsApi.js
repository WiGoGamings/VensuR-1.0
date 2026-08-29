import { httpRequest } from './httpClient'

export function getBotsStatus() {
  return httpRequest('/api/content/bots/status')
}

/**
 * @param {{ mode?: 'low' | 'normal' | 'high' }} payload
 */
export function updateBotsBehavior(payload) {
  return httpRequest('/api/content/bots/behavior', {
    method: 'PATCH',
    body: payload,
  })
}

/**
 * @param {{ forceCreate?: boolean, bursts?: number }} payload
 */
export function runBotsTick(payload = {}) {
  return httpRequest('/api/content/bots/tick', {
    method: 'POST',
    body: payload,
  })
}

export function reimportBotsMedia() {
  return httpRequest('/api/content/bots/media/reimport', {
    method: 'POST',
    body: {},
  })
}

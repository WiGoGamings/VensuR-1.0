import { httpRequest } from './httpClient'

/** @returns {Promise<{ ttlHours: number, items: Array<any> }>} */
export function getMyRecordings() {
  return httpRequest('/api/content/me/recordings')
}

/**
 * @param {string} username
 * @returns {Promise<{ items: Array<any> }>}
 */
export function getUserRecordings(username) {
  return httpRequest(`/api/content/users/${encodeURIComponent(String(username || '').trim())}/recordings`)
}

/**
 * @param {string} recordingId
 */
export function deleteRecording(recordingId) {
  return httpRequest(`/api/content/me/recordings/${encodeURIComponent(String(recordingId))}`, {
    method: 'DELETE',
  })
}

/**
 * @param {{ blob: Blob, title?: string, sessionId?: string, durationSec?: number }} payload
 */
export function uploadLiveRecording({ blob, title = '', sessionId = '', durationSec = 0 }) {
  const formData = new FormData()
  const extension = (blob.type || '').includes('mp4') ? 'mp4' : 'webm'
  formData.append('media', blob, `grabacion-${Date.now()}.${extension}`)
  formData.append('title', title)
  formData.append('sessionId', sessionId)
  formData.append('durationSec', String(Math.max(0, Math.round(durationSec))))

  return httpRequest('/api/content/live/recordings', {
    method: 'POST',
    body: formData,
    isFormData: true,
    timeoutMs: 120_000,
  })
}

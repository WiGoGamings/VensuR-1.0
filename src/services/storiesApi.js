import { httpRequest } from './httpClient'

export function getStoriesFeed() {
  return httpRequest('/api/content/stories')
}

export function getMyStories() {
  return httpRequest('/api/content/me/stories')
}

/**
 * @param {{
 * title: string,
 * description: string,
 * mediaFile: File | null,
 * metadata?: {
 *   editor?: {
 *     overlayText?: string,
 *     locationTag?: string,
 *     showClock?: boolean,
 *     clockLabel?: string,
 *     textColor?: string,
 *     textSize?: number,
 *     textPositionY?: number,
 *     textAlign?: 'left' | 'center' | 'right',
 *     filter?: 'none' | 'warm' | 'cold' | 'mono' | 'dramatic'
 *   },
 *   music?: {
 *     trackId?: string,
 *     startSeconds?: number,
 *     volume?: number
 *   }
 * }
 * }} payload
 */
export function createStory(payload) {
  const formData = new FormData()
  formData.append('title', payload.title)
  formData.append('description', payload.description)

  if (payload.metadata && typeof payload.metadata === 'object') {
    formData.append('metadata', JSON.stringify(payload.metadata))
  }

  if (payload.mediaFile) {
    formData.append('media', payload.mediaFile)
  }

  return httpRequest('/api/content/me/stories', {
    method: 'POST',
    body: formData,
    isFormData: true,
  })
}

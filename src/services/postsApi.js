import { initialPosts } from '../data/feedData'
import { httpRequest } from './httpClient'

/** @typedef {import('../data/feedData').Post} Post */

/** @param {string} mediaUrl */
function isVideoMedia(mediaUrl) {
  return /\.(mp4|webm|mov|m4v)$/i.test(mediaUrl)
}

/**
 * @param {any} apiPost
 * @returns {Post}
 */
function toLegacyPost(apiPost) {
  const mediaLabel =
    typeof apiPost.media === 'string' && apiPost.media
      ? apiPost.media
      : apiPost.mediaUrl
        ? isVideoMedia(apiPost.mediaUrl)
          ? 'Video ciudadano'
          : 'Imagen ciudadana'
        : 'Publicacion ciudadana'

  return {
    id: apiPost.id,
    author: apiPost.author ?? 'Tu voz ciudadana',
    meta: apiPost.meta ?? 'reciente · Venezuela',
    tag: apiPost.tag ?? 'NUEVO',
    tagClass: apiPost.tagClass ?? 'historia',
    media: mediaLabel,
    caption: apiPost.caption ?? '',
    reactions: Number(apiPost.reactions ?? 0),
    comments: Number(apiPost.comments ?? 0),
    tone: apiPost.tone ?? 'new',
    mediaUrl: apiPost.mediaUrl ?? '',
    createdAt: apiPost.createdAt ?? new Date().toISOString(),
    location: apiPost.location ?? 'Venezuela',
    ownerId: apiPost.ownerId ?? '',
    likedByViewer: Boolean(apiPost.likedByViewer),
  }
}

/** @returns {Promise<Post[]>} */
async function loadFallbackPosts() {
  try {
    const response = await fetch('/mock/posts.json')
    if (!response.ok) throw new Error('No se pudo cargar el archivo de mock')

    /** @type {Post[]} */
    const posts = await response.json()
    return posts
  } catch {
    return initialPosts
  }
}

/** @returns {Promise<Post[]>} */
export async function getPosts() {
  try {
    const payload = await httpRequest('/api/content/posts')
    return Array.isArray(payload.items) ? payload.items.map(toLegacyPost) : []
  } catch {
    return loadFallbackPosts()
  }
}

/**
 * @param {{ caption: string, mediaFile: File | null, alsoStory?: boolean }} payload
 * @returns {Promise<Post>}
 */
export async function createPost(payload) {
  const formData = new FormData()
  formData.append('caption', payload.caption)
  formData.append('location', 'Venezuela')
  formData.append('alsoStory', payload.alsoStory ? 'true' : 'false')

  if (payload.mediaFile) {
    formData.append('media', payload.mediaFile)
  }

  const response = await httpRequest('/api/content/me/posts', {
    method: 'POST',
    body: formData,
    isFormData: true,
  })

  return toLegacyPost(response.post)
}

/**
 * @param {string | number} postId
 * @param {number} delta Intencion: 1 = dar like, -1 = quitar.
 * @returns {Promise<{ post: Post | null, liked: boolean }>}
 */
export async function updatePostReactions(postId, delta) {
  const response = await httpRequest(`/api/content/posts/${encodeURIComponent(String(postId))}/reaction`, {
    method: 'PATCH',
    body: { delta },
  })

  return {
    post: response.post ? toLegacyPost(response.post) : null,
    liked: Boolean(response.liked),
  }
}

/**
 * @param {string | number} postId
 */
export async function getPostComments(postId) {
  const response = await httpRequest(`/api/content/posts/${encodeURIComponent(String(postId))}/comments`)
  return Array.isArray(response.items) ? response.items : []
}

/**
 * @param {string | number} postId
 * @param {string} text
 */
export async function createPostComment(postId, text) {
  const response = await httpRequest(`/api/content/posts/${encodeURIComponent(String(postId))}/comments`, {
    method: 'POST',
    body: { text },
  })

  return {
    comment: response.comment ?? null,
    post: response.post ? toLegacyPost(response.post) : null,
  }
}

import { httpRequest } from './httpClient'

/**
 * @param {{
 * email: string,
 * username: string,
 * displayName: string,
 * password: string
 * }} payload
 */
export function registerUser(payload) {
  return httpRequest('/api/auth/register', {
    method: 'POST',
    body: payload,
  })
}

/**
 * @param {{ identifier: string, password: string }} payload
 */
export function loginUser(payload) {
  return httpRequest('/api/auth/login', {
    method: 'POST',
    body: payload,
  })
}

/**
 * @param {{ email: string, code: string }} payload
 */
export function verifyEmail(payload) {
  return httpRequest('/api/auth/verify-email', {
    method: 'POST',
    body: payload,
  })
}

/**
 * @param {{ email: string }} payload
 */
export function resendVerification(payload) {
  return httpRequest('/api/auth/resend-verification', {
    method: 'POST',
    body: payload,
  })
}

/**
 * @param {{ idToken: string }} payload
 */
export function loginWithGoogle(payload) {
  return httpRequest('/api/auth/oauth/google', {
    method: 'POST',
    body: payload,
  })
}

/**
 * @param {{ idToken: string, firstName?: string, lastName?: string }} payload
 */
export function loginWithApple(payload) {
  return httpRequest('/api/auth/oauth/apple', {
    method: 'POST',
    body: payload,
  })
}

export function getAuthProviders() {
  return httpRequest('/api/auth/providers')
}

export function getCurrentUser() {
  return httpRequest('/api/auth/me')
}

/**
 * @param {{ displayName?: string, username?: string, email?: string, phone?: string, bio?: string, profileVisibility?: 'public' | 'private' }} payload
 */
export function updateCurrentUser(payload) {
  return httpRequest('/api/auth/me', {
    method: 'PATCH',
    body: payload,
  })
}

/**
 * @param {File} avatarFile
 */
export function updateCurrentUserAvatar(avatarFile) {
  const formData = new FormData()
  formData.append('avatar', avatarFile)

  return httpRequest('/api/auth/me/avatar', {
    method: 'PATCH',
    body: formData,
    isFormData: true,
  })
}

/**
 * @param {File} coverFile
 */
export function updateCurrentUserCover(coverFile) {
  const formData = new FormData()
  formData.append('cover', coverFile)

  return httpRequest('/api/auth/me/cover', {
    method: 'PATCH',
    body: formData,
    isFormData: true,
  })
}

export function getCurrentUserMetrics() {
  return httpRequest('/api/content/me/metrics')
}

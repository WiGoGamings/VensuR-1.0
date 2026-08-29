/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  getCurrentUser,
  loginUser,
  loginWithApple,
  loginWithGoogle,
  resendVerification,
  registerUser,
  verifyEmail,
  updateCurrentUser,
  updateCurrentUserAvatar,
  updateCurrentUserCover,
} from '../services/authApi'
import { setAuthToken } from '../services/httpClient'

const AUTH_TOKEN_KEY = 'vensur.auth.token'
const PROFILE_DRAFT_STORAGE_PREFIX = 'vensur.profile.draft.'

const AuthContext = createContext(null)

function hasStorage() {
  return typeof window !== 'undefined' && window.localStorage
}

function readStoredToken() {
  if (!hasStorage()) return ''
  return window.localStorage.getItem(AUTH_TOKEN_KEY) ?? ''
}

function writeStoredToken(token) {
  if (!hasStorage()) return

  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
  }
}

function getProfileDraftStorageKey(userId) {
  return `${PROFILE_DRAFT_STORAGE_PREFIX}${userId}`
}

function readStoredProfileDraft(userId) {
  if (!hasStorage() || !userId) return null

  const rawValue = window.localStorage.getItem(getProfileDraftStorageKey(userId))
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function clearStoredProfileDraft(userId) {
  if (!hasStorage() || !userId) return
  window.localStorage.removeItem(getProfileDraftStorageKey(userId))
}

function getProfileFieldDraftValue(source, key) {
  const value = source && typeof source === 'object' ? source[key] : null
  return typeof value === 'string' ? value : null
}

function buildProfileSavePayload(user, storedDraft) {
  if (!user || !storedDraft || typeof storedDraft !== 'object') {
    return null
  }

  const hasProfileDraft = [
    'displayNameDraft',
    'usernameDraft',
    'emailDraft',
    'phoneDraft',
    'bioDraft',
  ].some((key) => typeof storedDraft[key] === 'string')

  if (!hasProfileDraft) {
    return null
  }

  const payload = {
    displayName: getProfileFieldDraftValue(storedDraft, 'displayNameDraft') ?? (user.displayName || ''),
    username: getProfileFieldDraftValue(storedDraft, 'usernameDraft') ?? (user.username || ''),
    email: getProfileFieldDraftValue(storedDraft, 'emailDraft') ?? (user.email || ''),
    phone: getProfileFieldDraftValue(storedDraft, 'phoneDraft') ?? (user.phone || ''),
    bio: getProfileFieldDraftValue(storedDraft, 'bioDraft') ?? (user.bio || ''),
  }

  const hasChanges =
    payload.displayName !== (user.displayName || '') ||
    payload.username !== (user.username || '') ||
    payload.email !== (user.email || '') ||
    payload.phone !== (user.phone || '') ||
    payload.bio !== (user.bio || '')

  return hasChanges ? payload : null
}

/**
 * @param {{ children: import('react').ReactNode }} props
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isBooting, setIsBooting] = useState(true)
  const [isBusy, setIsBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [verificationChallenge, setVerificationChallenge] = useState(null)

  const applySession = useCallback((token, nextUser) => {
    setAuthToken(token)
    writeStoredToken(token)
    setUser(nextUser)
  }, [])

  const clearSession = useCallback(() => {
    setAuthToken('')
    writeStoredToken('')
    setUser(null)
  }, [])

  const saveVerificationChallenge = useCallback((payload) => {
    const email = typeof payload?.email === 'string' ? payload.email : ''
    if (!email) return

    setVerificationChallenge({
      email,
      verificationSent: Boolean(payload?.verificationSent),
      debugVerificationCode:
        typeof payload?.debugVerificationCode === 'string' ? payload.debugVerificationCode : '',
    })
  }, [])

  useEffect(() => {
    let isMounted = true

    async function bootstrapAuth() {
      const token = readStoredToken()
      if (!token) {
        if (isMounted) setIsBooting(false)
        return
      }

      setAuthToken(token)

      try {
        const response = await getCurrentUser()
        if (!isMounted) return

        setUser(response.user)
      } catch {
        if (!isMounted) return
        clearSession()
      } finally {
        if (isMounted) setIsBooting(false)
      }
    }

    bootstrapAuth()

    return () => {
      isMounted = false
    }
  }, [clearSession])

  const register = useCallback(
    async (payload) => {
      setIsBusy(true)
      setAuthError('')

      try {
        const response = await registerUser(payload)

        if (response?.requiresEmailVerification) {
          saveVerificationChallenge({
            email: response.email || payload.email,
            verificationSent: response.verificationSent,
            debugVerificationCode: response.debugVerificationCode,
          })
          return null
        }

        applySession(response.token, response.user)
        setVerificationChallenge(null)
        return response.user
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'No se pudo crear la cuenta')
        return null
      } finally {
        setIsBusy(false)
      }
    },
    [applySession, saveVerificationChallenge],
  )

  const login = useCallback(
    async (payload) => {
      setIsBusy(true)
      setAuthError('')

      try {
        const response = await loginUser(payload)
        applySession(response.token, response.user)
        setVerificationChallenge(null)
        return response.user
      } catch (error) {
        const verificationErrorCode =
          error && typeof error === 'object' ? error.errorCode : ''

        if (verificationErrorCode === 'EMAIL_NOT_VERIFIED') {
          saveVerificationChallenge({
            email: error.email || payload.identifier,
            verificationSent: error.verificationSent,
            debugVerificationCode: error.debugVerificationCode,
          })
        }

        setAuthError(error instanceof Error ? error.message : 'No se pudo iniciar sesion')
        return null
      } finally {
        setIsBusy(false)
      }
    },
    [applySession, saveVerificationChallenge],
  )

  const socialGoogleLogin = useCallback(
    async (idToken) => {
      setIsBusy(true)
      setAuthError('')

      try {
        const response = await loginWithGoogle({ idToken })
        applySession(response.token, response.user)
        return response.user
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'No se pudo iniciar sesion con Google')
        return null
      } finally {
        setIsBusy(false)
      }
    },
    [applySession],
  )

  const socialAppleLogin = useCallback(
    async ({ idToken, firstName = '', lastName = '' }) => {
      setIsBusy(true)
      setAuthError('')

      try {
        const response = await loginWithApple({ idToken, firstName, lastName })
        applySession(response.token, response.user)
        return response.user
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'No se pudo iniciar sesion con Apple')
        return null
      } finally {
        setIsBusy(false)
      }
    },
    [applySession],
  )

  const logout = useCallback(async () => {
    setIsBusy(true)
    setAuthError('')
    setVerificationChallenge(null)

    try {
      if (user?.id) {
        const storedDraft = readStoredProfileDraft(user.id)
        const payload = buildProfileSavePayload(user, storedDraft)
        let draftPersisted = true

        if (payload) {
          // Guardado del borrador de perfil en modo best-effort: nunca debe bloquear el logout.
          try {
            await updateCurrentUser(payload)
          } catch {
            // El borrador se conserva en localStorage para reintentarlo tras volver a entrar.
            draftPersisted = false
          }
        }

        if (draftPersisted) {
          clearStoredProfileDraft(user.id)
        }
      }

      clearSession()
      return true
    } finally {
      setIsBusy(false)
    }
  }, [clearSession, user])

  const verifyEmailCode = useCallback(
    async ({ email, code }) => {
      setIsBusy(true)
      setAuthError('')

      try {
        const response = await verifyEmail({ email, code })
        applySession(response.token, response.user)
        setVerificationChallenge(null)
        return response.user
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'No se pudo verificar el correo')
        return null
      } finally {
        setIsBusy(false)
      }
    },
    [applySession],
  )

  const resendVerificationCode = useCallback(
    async (email) => {
      setIsBusy(true)
      setAuthError('')

      try {
        const response = await resendVerification({ email })

        saveVerificationChallenge({
          email,
          verificationSent: response?.sent,
          debugVerificationCode: response?.debugVerificationCode,
        })

        return true
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'No se pudo reenviar el codigo')
        return false
      } finally {
        setIsBusy(false)
      }
    },
    [saveVerificationChallenge],
  )

  const clearVerificationChallenge = useCallback(() => {
    setVerificationChallenge(null)
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const response = await getCurrentUser()
      setUser(response.user)
      return response.user
    } catch {
      return null
    }
  }, [])

  const updateProfile = useCallback(async (payload) => {
    setIsBusy(true)
    setAuthError('')

    try {
      const response = await updateCurrentUser(payload)
      setUser(response.user)
      return response.user
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo actualizar el perfil')
      return null
    } finally {
      setIsBusy(false)
    }
  }, [])

  const updateAvatar = useCallback(async (avatarFile) => {
    if (!avatarFile) return null

    setIsBusy(true)
    setAuthError('')

    try {
      const response = await updateCurrentUserAvatar(avatarFile)
      setUser(response.user)
      return response.user
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo actualizar la foto de perfil')
      return null
    } finally {
      setIsBusy(false)
    }
  }, [])

  const updateCover = useCallback(async (coverFile) => {
    if (!coverFile) return null

    setIsBusy(true)
    setAuthError('')

    try {
      const response = await updateCurrentUserCover(coverFile)
      setUser(response.user)
      return response.user
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'No se pudo actualizar la foto de portada')
      return null
    } finally {
      setIsBusy(false)
    }
  }, [])

  const clearAuthError = useCallback(() => {
    setAuthError('')
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isBooting,
      isAuthBusy: isBusy,
      authError,
      verificationChallenge,
      register,
      login,
      loginWithGoogle: socialGoogleLogin,
      loginWithApple: socialAppleLogin,
      verifyEmailCode,
      resendVerificationCode,
      clearVerificationChallenge,
      logout,
      refreshUser,
      updateProfile,
      updateAvatar,
      updateCover,
      clearAuthError,
    }),
    [
      user,
      isBooting,
      isBusy,
      authError,
      verificationChallenge,
      register,
      login,
      socialGoogleLogin,
      socialAppleLogin,
      verifyEmailCode,
      resendVerificationCode,
      clearVerificationChallenge,
      logout,
      refreshUser,
      updateProfile,
      updateAvatar,
      updateCover,
      clearAuthError,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider')
  }

  return context
}

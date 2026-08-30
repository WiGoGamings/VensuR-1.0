import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getCurrentUserMetrics } from '../services/authApi'
import {
  getBotsStatus,
  reimportBotsMedia,
  runBotsTick,
  updateBotsBehavior,
} from '../services/botsApi'
import { createStory, getMyStories } from '../services/storiesApi'
import { getMyPosts } from '../services/postsApi'
import { deleteRecording, getMyRecordings } from '../services/recordingsApi'
import { useLiveBroadcast } from '../contexts/LiveBroadcastContext'
import './Pages.css'

const StoryStudio = lazy(() => import('../components/composer/StoryStudio'))
const PostComposer = lazy(() => import('../components/composer/PostComposer'))

const THEME_MODE_STORAGE_KEY = 'vensur.ui.theme'
const PROFILE_DRAFT_STORAGE_PREFIX = 'vensur.profile.draft.'
const AVATAR_VIDEO_MAX_SECONDS = 5
const AVATAR_IMAGE_SIZE = 512
const COVER_IMAGE_WIDTH = 1536
const COVER_IMAGE_HEIGHT = 512

function getInitialThemeMode() {
  if (typeof window === 'undefined') return 'dark'

  const stored = window.localStorage.getItem(THEME_MODE_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }

  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function hasBrowserStorage() {
  return typeof window !== 'undefined' && window.localStorage
}

function getProfileDraftStorageKey(userId) {
  return `${PROFILE_DRAFT_STORAGE_PREFIX}${userId}`
}

function readStoredProfileDraft(userId) {
  if (!hasBrowserStorage() || !userId) return null

  const rawValue = window.localStorage.getItem(getProfileDraftStorageKey(userId))
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeStoredProfileDraft(userId, payload) {
  if (!hasBrowserStorage() || !userId) return
  window.localStorage.setItem(getProfileDraftStorageKey(userId), JSON.stringify(payload))
}

function clearStoredProfileDraft(userId) {
  if (!hasBrowserStorage() || !userId) return
  window.localStorage.removeItem(getProfileDraftStorageKey(userId))
}

function isImageFile(file) {
  const mimeType = typeof file?.type === 'string' ? file.type.toLowerCase() : ''
  if (mimeType.startsWith('image/')) return true

  const fileName = typeof file?.name === 'string' ? file.name.toLowerCase() : ''
  return /\.(jpg|jpeg|png|webp|gif|bmp|svg|heic|heif|avif)$/i.test(fileName)
}

function isVideoFile(file) {
  const mimeType = typeof file?.type === 'string' ? file.type.toLowerCase() : ''
  if (mimeType.startsWith('video/')) return true

  const fileName = typeof file?.name === 'string' ? file.name.toLowerCase() : ''
  return /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(fileName)
}

function isVideoAvatarUrl(url) {
  const value = typeof url === 'string' ? url.toLowerCase() : ''
  return /\.(mp4|webm|mov|m4v)(\?|$)/.test(value)
}

function getVideoDurationSeconds(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = objectUrl

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      video.removeAttribute('src')
      video.load()
    }

    video.onloadedmetadata = () => {
      const duration = Number(video.duration)
      cleanup()

      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('No se pudo validar la duracion del video.'))
        return
      }

      resolve(duration)
    }

    video.onerror = () => {
      cleanup()
      reject(new Error('No se pudo leer el video seleccionado.'))
    }
  })
}

function normalizeAvatarImageFile(file, targetSize = AVATAR_IMAGE_SIZE) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || image.width
        const sourceHeight = image.naturalHeight || image.height

        if (!sourceWidth || !sourceHeight) {
          throw new Error('No se pudo leer el tamano de la imagen.')
        }

        const cropSide = Math.min(sourceWidth, sourceHeight)
        const cropX = Math.floor((sourceWidth - cropSide) / 2)
        const cropY = Math.floor((sourceHeight - cropSide) / 2)
        const canvas = document.createElement('canvas')
        canvas.width = targetSize
        canvas.height = targetSize

        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('No se pudo preparar la imagen de perfil.')
        }

        context.drawImage(
          image,
          cropX,
          cropY,
          cropSide,
          cropSide,
          0,
          0,
          targetSize,
          targetSize,
        )

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl)

          if (!blob) {
            reject(new Error('No se pudo convertir la imagen de perfil.'))
            return
          }

          const normalizedName = file.name.replace(/\.[^.]+$/, '') || 'avatar'
          const normalizedFile = new File([blob], `${normalizedName}.jpg`, { type: 'image/jpeg' })
          resolve(normalizedFile)
        }, 'image/jpeg', 0.9)
      } catch (error) {
        URL.revokeObjectURL(objectUrl)
        reject(error)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo leer la imagen seleccionada.'))
    }

    image.src = objectUrl
  })
}

function normalizeCoverImageFile(file, targetWidth = COVER_IMAGE_WIDTH, targetHeight = COVER_IMAGE_HEIGHT) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || image.width
        const sourceHeight = image.naturalHeight || image.height

        if (!sourceWidth || !sourceHeight) {
          throw new Error('No se pudo leer el tamano de la imagen.')
        }

        const sourceRatio = sourceWidth / sourceHeight
        const targetRatio = targetWidth / targetHeight
        let cropWidth = sourceWidth
        let cropHeight = sourceHeight
        let cropX = 0
        let cropY = 0

        if (sourceRatio > targetRatio) {
          cropWidth = Math.floor(sourceHeight * targetRatio)
          cropX = Math.floor((sourceWidth - cropWidth) / 2)
        } else {
          cropHeight = Math.floor(sourceWidth / targetRatio)
          cropY = Math.floor((sourceHeight - cropHeight) / 2)
        }

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight

        const context = canvas.getContext('2d')
        if (!context) {
          throw new Error('No se pudo preparar la portada.')
        }

        context.drawImage(
          image,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          targetWidth,
          targetHeight,
        )

        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl)

          if (!blob) {
            reject(new Error('No se pudo convertir la imagen de portada.'))
            return
          }

          const normalizedName = file.name.replace(/\.[^.]+$/, '') || 'cover'
          const normalizedFile = new File([blob], `${normalizedName}.jpg`, { type: 'image/jpeg' })
          resolve(normalizedFile)
        }, 'image/jpeg', 0.9)
      } catch (error) {
        URL.revokeObjectURL(objectUrl)
        reject(error)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo leer la imagen seleccionada.'))
    }

    image.src = objectUrl
  })
}

const profileTabs = ['Publicaciones', 'Historias', 'Denuncias', 'Guardado']

const profileCells = [
  { id: 'cell-1', badge: 'HISTORIA', badgeClass: 'historia' },
  { id: 'cell-2', badge: 'DENUNCIA', badgeClass: 'denuncia' },
  { id: 'cell-3', badge: 'HISTORIA', badgeClass: 'historia' },
  { id: 'cell-4', badge: 'EN VIVO', badgeClass: 'live' },
  { id: 'cell-5' },
  { id: 'cell-6', badge: 'DENUNCIA', badgeClass: 'denuncia' },
  { id: 'cell-7', badge: 'HISTORIA', badgeClass: 'historia' },
  { id: 'cell-8' },
]

/**
 * @param {{
 * posts: import('../data/feedData').Post[],
 * likedPostIds: Array<string | number>
 * }} props
 */
export default function PerfilPage({ posts, likedPostIds }) {
  const {
    user,
    updateProfile,
    updateAvatar,
    updateCover,
    logout,
    isAuthBusy,
    authError,
    clearAuthError,
  } = useAuth()
  const { recordingStatus } = useLiveBroadcast()
  const location = useLocation()
  const navigate = useNavigate()
  const createFlowFromQuery = useMemo(() => {
    const createType = (new URLSearchParams(location.search).get('crear') || '').trim().toLowerCase()

    if (createType === 'historia') return 'story'
    if (createType === 'publicacion') return 'post'
    return ''
  }, [location.search])
  const storedProfileDraft = useMemo(() => readStoredProfileDraft(user?.id), [user?.id])
  const [activeTab, setActiveTab] = useState(() => {
    if (createFlowFromQuery) return 'Publicaciones'

    const storedTab = typeof storedProfileDraft?.activeTab === 'string'
      ? storedProfileDraft.activeTab
      : ''
    return profileTabs.includes(storedTab) ? storedTab : 'Publicaciones'
  })
  const [bioDraft, setBioDraft] = useState(
    () => (typeof storedProfileDraft?.bioDraft === 'string' ? storedProfileDraft.bioDraft : null),
  )
  const [displayNameDraft, setDisplayNameDraft] = useState(
    () => (typeof storedProfileDraft?.displayNameDraft === 'string' ? storedProfileDraft.displayNameDraft : null),
  )
  const [usernameDraft, setUsernameDraft] = useState(
    () => (typeof storedProfileDraft?.usernameDraft === 'string' ? storedProfileDraft.usernameDraft : null),
  )
  const [emailDraft, setEmailDraft] = useState(
    () => (typeof storedProfileDraft?.emailDraft === 'string' ? storedProfileDraft.emailDraft : null),
  )
  const [phoneDraft, setPhoneDraft] = useState(
    () => (typeof storedProfileDraft?.phoneDraft === 'string' ? storedProfileDraft.phoneDraft : null),
  )
  const [profileStatus, setProfileStatus] = useState('')
  const [avatarStatus, setAvatarStatus] = useState('')
  const [coverStatus, setCoverStatus] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [themeMode, setThemeMode] = useState(getInitialThemeMode)
  const avatarInputRef = useRef(null)
  const coverInputRef = useRef(null)
  const avatarMenuRef = useRef(null)
  const settingsPanelRef = useRef(null)
  const [creator, setCreator] = useState(() => (createFlowFromQuery === 'story' || createFlowFromQuery === 'post' ? createFlowFromQuery : ''))
  const [composerStatus, setComposerStatus] = useState('')
  const [localPosts, setLocalPosts] = useState([])
  const [remotePosts, setRemotePosts] = useState([])
  const [stories, setStories] = useState([])
  const [storiesError, setStoriesError] = useState('')
  const [recordings, setRecordings] = useState([])
  const [recordingsTtlHours, setRecordingsTtlHours] = useState(72)
  const [recordingsError, setRecordingsError] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [metricsError, setMetricsError] = useState('')
  const [isMetricsLoading, setIsMetricsLoading] = useState(false)
  const [botsStatus, setBotsStatus] = useState(null)
  const [botsModeDraft, setBotsModeDraft] = useState('normal')
  const [botsBurstDraft, setBotsBurstDraft] = useState('3')
  const [botsMessage, setBotsMessage] = useState('')
  const [botsError, setBotsError] = useState('')
  const [isBotsBusy, setIsBotsBusy] = useState(false)

  const remoteMyPosts = useMemo(() => {
    if (!user) return []
    return posts.filter((post) => post.ownerId === user.id)
  }, [posts, user])

  const myPosts = useMemo(() => {
    const merged = new Map()

    for (const post of [...localPosts, ...remotePosts, ...remoteMyPosts]) {
      if (!post?.id || merged.has(post.id)) continue
      merged.set(post.id, post)
    }

    return Array.from(merged.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    )
  }, [localPosts, remotePosts, remoteMyPosts])

  const myDenuncias = useMemo(() => {
    const sensitivePattern = /(denunc|alert|operativo|corrup|deten|repres|violenc|ddhh|apag|crisis)/i

    return myPosts.filter((post) => {
      const text = `${post.caption || ''} ${post.location || ''}`
      return sensitivePattern.test(text)
    })
  }, [myPosts])

  const publicationCount = myPosts.length
  const reactionCount = likedPostIds.length

  const metricsActivity = Array.isArray(metrics?.activity) ? metrics.activity : []
  const maxActivity = metricsActivity.reduce(
    (max, item) => Math.max(max, Number(item?.posts || 0) + Number(item?.comments || 0)),
    1,
  )

  useEffect(() => {
    let isMounted = true

    async function loadBotsStatus() {
      try {
        const response = await getBotsStatus()
        if (!isMounted) return

        setBotsStatus(response)
        const mode = typeof response?.behavior?.mode === 'string' ? response.behavior.mode : 'normal'
        setBotsModeDraft(mode)
        setBotsError('')
      } catch {
        if (!isMounted) return
        setBotsError('No se pudo leer el estado de bots en este momento.')
      }
    }

    if (activeTab === 'Bots') {
      loadBotsStatus()
    }

    return () => {
      isMounted = false
    }
  }, [activeTab])

  useEffect(() => {
    let isMounted = true

    async function loadMetrics() {
      setIsMetricsLoading(true)
      setMetricsError('')

      try {
        const response = await getCurrentUserMetrics()
        if (!isMounted) return
        setMetrics(response)
      } catch {
        if (!isMounted) return
        setMetricsError('No se pudieron cargar tus metricas personales.')
      } finally {
        if (isMounted) {
          setIsMetricsLoading(false)
        }
      }
    }

    if (activeTab === 'Metricas' && user?.id) {
      loadMetrics()
    }

    return () => {
      isMounted = false
    }
  }, [activeTab, user?.id])

  useEffect(() => {
    let isMounted = true

    async function loadStories() {
      try {
        const response = await getMyStories()
        if (!isMounted) return

        setStories(Array.isArray(response.items) ? response.items : [])
        setStoriesError('')
      } catch {
        if (!isMounted) return
        setStoriesError('No se pudieron cargar tus historias privadas.')
      }
    }

    async function loadPosts() {
      try {
        const items = await getMyPosts()
        if (isMounted) setRemotePosts(Array.isArray(items) ? items : [])
      } catch {
        // se mantiene la ventana del feed como respaldo
      }
    }

    async function loadRecordings() {
      try {
        const response = await getMyRecordings()
        if (!isMounted) return
        setRecordings(Array.isArray(response.items) ? response.items : [])
        if (Number.isFinite(Number(response.ttlHours))) setRecordingsTtlHours(Number(response.ttlHours))
        setRecordingsError('')
      } catch {
        if (isMounted) setRecordingsError('No se pudieron cargar tus grabaciones guardadas.')
      }
    }

    if (user?.id) {
      loadStories()
      loadPosts()
      loadRecordings()
    }

    return () => {
      isMounted = false
    }
  }, [user?.id])

  // Cuando termina de subir una grabación de en vivo, recarga la lista.
  useEffect(() => {
    if (recordingStatus !== 'guardada' || !user?.id) return
    let isMounted = true
    getMyRecordings()
      .then((response) => {
        if (isMounted) setRecordings(Array.isArray(response.items) ? response.items : [])
      })
      .catch(() => {})
    return () => {
      isMounted = false
    }
  }, [recordingStatus, user?.id])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', themeMode)
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode)
    }
  }, [themeMode])

  useEffect(() => {
    if (!settingsOpen) return undefined

    const onPointerDown = (event) => {
      if (!settingsPanelRef.current) return

      if (!settingsPanelRef.current.contains(event.target)) {
        setSettingsOpen(false)
      }
    }

    const onEscape = (event) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onEscape)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onEscape)
    }
  }, [settingsOpen])

  useEffect(() => {
    if (!avatarMenuOpen) return undefined

    const onPointerDown = (event) => {
      if (!avatarMenuRef.current) return

      if (!avatarMenuRef.current.contains(event.target)) {
        setAvatarMenuOpen(false)
      }
    }

    const onEscape = (event) => {
      if (event.key === 'Escape') {
        setAvatarMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onEscape)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onEscape)
    }
  }, [avatarMenuOpen])

  useEffect(() => {
    if (creator !== 'menu') return undefined

    const close = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && event.target?.closest?.('.profile-create-menu')) return
      setCreator('')
    }

    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [creator])

  useEffect(() => {
    if (!user?.id) return

    const hasProfileFieldDraft = [
      displayNameDraft,
      usernameDraft,
      emailDraft,
      phoneDraft,
      bioDraft,
    ].some((value) => typeof value === 'string')

    const shouldPersist = hasProfileFieldDraft || activeTab !== 'Publicaciones'

    if (!shouldPersist) {
      clearStoredProfileDraft(user.id)
      return
    }

    writeStoredProfileDraft(user.id, {
      displayNameDraft,
      usernameDraft,
      emailDraft,
      phoneDraft,
      bioDraft,
      activeTab,
      updatedAt: new Date().toISOString(),
    })
  }, [
    user?.id,
    displayNameDraft,
    usernameDraft,
    emailDraft,
    phoneDraft,
    bioDraft,
    activeTab,
  ])

  if (!user) {
    return null
  }

  const displayNameValue = displayNameDraft ?? user.displayName ?? ''
  const usernameValue = usernameDraft ?? user.username ?? ''
  const emailValue = emailDraft ?? user.email ?? ''
  const phoneValue = phoneDraft ?? user.phone ?? ''
  const bioValue = bioDraft ?? user.bio ?? ''
  const profileVisibility = user.profileVisibility === 'public' ? 'public' : 'private'
  const isPrivateProfile = profileVisibility === 'private'

  const onProfileSubmit = async (event) => {
    event.preventDefault()
    setProfileStatus('')
    clearAuthError()

    const updated = await updateProfile({
      displayName: displayNameValue,
      username: usernameValue,
      email: emailValue,
      phone: phoneValue,
      bio: bioValue,
    })

    if (!updated) return
    setDisplayNameDraft(null)
    setUsernameDraft(null)
    setEmailDraft(null)
    setPhoneDraft(null)
    setBioDraft(null)
    setProfileStatus('Ajustes guardados correctamente.')
  }

  const onSelectAvatarUpload = () => {
    avatarInputRef.current?.click()
    setAvatarMenuOpen(false)
  }

  const onSelectCoverUpload = () => {
    coverInputRef.current?.click()
    setAvatarMenuOpen(false)
  }

  const onToggleAvatarMenu = () => {
    setSettingsOpen(false)
    setCreator('')
    setAvatarMenuOpen((current) => !current)
  }

  const onToggleProfileVisibility = async () => {
    const nextVisibility = isPrivateProfile ? 'public' : 'private'

    setProfileStatus('')
    clearAuthError()

    const updated = await updateProfile({
      profileVisibility: nextVisibility,
    })

    if (!updated) return

    setProfileStatus(
      nextVisibility === 'public'
        ? 'Perfil publico activado: cualquiera puede ver tu perfil, historias y publicaciones.'
        : 'Perfil privado activado: solo tus amigos pueden ver tu perfil, historias y publicaciones.',
    )
  }

  const onAvatarFile = async (event) => {
    const file = event.target.files?.[0] ?? null

    if (!file) return

    if (!isImageFile(file) && !isVideoFile(file)) {
      setAvatarStatus('Selecciona una imagen o un video valido para el perfil.')
      event.target.value = ''
      return
    }

    setAvatarStatus('Preparando archivo...')
    clearAuthError()

    let fileToUpload = file

    try {
      if (isVideoFile(file)) {
        const durationSeconds = await getVideoDurationSeconds(file)

        if (durationSeconds > AVATAR_VIDEO_MAX_SECONDS) {
          setAvatarStatus('El video de perfil debe durar maximo 5 segundos.')
          event.target.value = ''
          return
        }
      } else {
        fileToUpload = await normalizeAvatarImageFile(file)
      }
    } catch (error) {
      setAvatarStatus(error instanceof Error ? error.message : 'No se pudo preparar el archivo.')
      event.target.value = ''
      return
    }

    setAvatarStatus('Subiendo avatar...')
    const updated = await updateAvatar(fileToUpload)
    if (!updated) {
      setAvatarStatus('No se pudo actualizar el perfil. Intenta de nuevo.')
      event.target.value = ''
      return
    }

    setAvatarStatus(isVideoFile(fileToUpload)
      ? 'Video de perfil actualizado correctamente.'
      : 'Foto de perfil actualizada correctamente.')
    event.target.value = ''
  }

  const onCoverFile = async (event) => {
    const file = event.target.files?.[0] ?? null

    if (!file) return

    if (!isImageFile(file)) {
      setCoverStatus('Selecciona una imagen valida para la portada.')
      event.target.value = ''
      return
    }

    setCoverStatus('Preparando portada...')
    clearAuthError()

    let fileToUpload = file

    try {
      fileToUpload = await normalizeCoverImageFile(file)
    } catch {
      setCoverStatus('No se pudo recortar automaticamente la portada. Se subira la imagen original.')
    }

    setCoverStatus('Subiendo portada...')
    const updated = await updateCover(fileToUpload)
    if (!updated) {
      setCoverStatus('No se pudo actualizar la portada. Intenta de nuevo.')
      event.target.value = ''
      return
    }

    setCoverStatus('Foto de portada actualizada correctamente.')
    event.target.value = ''
  }

  const onToggleSettingsPanel = () => {
    setCreator('')
    setAvatarMenuOpen(false)
    setSettingsOpen((current) => !current)
  }

  const onSelectThemeMode = (nextMode) => {
    const normalized = nextMode === 'light' ? 'light' : 'dark'
    setThemeMode(normalized)
    setProfileStatus(normalized === 'light' ? 'Modo claro activado.' : 'Modo oscuro activado.')
  }

  const onLogoutSession = async () => {
    const didLogout = await logout()
    if (didLogout) {
      navigate('/acceso', { replace: true })
    }
  }

  const onSwitchAccount = async () => {
    const didLogout = await logout()
    if (didLogout) {
      navigate('/acceso', { replace: true, state: { switchAccount: true } })
    }
  }

  const onRunBotsBurst = async () => {
    const burstsRaw = Number.parseInt(String(botsBurstDraft), 10)
    const bursts = Number.isFinite(burstsRaw) ? Math.max(1, Math.min(20, burstsRaw)) : 3

    setIsBotsBusy(true)
    setBotsMessage('')
    setBotsError('')

    try {
      const response = await runBotsTick({
        forceCreate: false,
        bursts,
      })

      const latest = await getBotsStatus()
      setBotsStatus(latest)
      setBotsMessage(
        `Rafaga ejecutada. Tick ${response?.summary?.tick ?? '-'} · comentarios: ${response?.summary?.collaborativeComments ?? 0}`,
      )
    } catch (error) {
      setBotsError(error instanceof Error ? error.message : 'No se pudo ejecutar la rafaga de bots.')
    } finally {
      setIsBotsBusy(false)
    }
  }

  const onChangeBotsMode = async () => {
    setIsBotsBusy(true)
    setBotsMessage('')
    setBotsError('')

    try {
      const response = await updateBotsBehavior({
        mode: botsModeDraft,
      })

      setBotsStatus((current) => ({
        ...(current || {}),
        behavior: response.behavior,
      }))
      setBotsMessage(`Modo de bots actualizado a ${response?.behavior?.mode ?? botsModeDraft}.`)
    } catch (error) {
      setBotsError(error instanceof Error ? error.message : 'No se pudo actualizar el modo de bots.')
    } finally {
      setIsBotsBusy(false)
    }
  }

  const onReimportBotsMedia = async () => {
    setIsBotsBusy(true)
    setBotsMessage('')
    setBotsError('')

    try {
      const response = await reimportBotsMedia()
      const latest = await getBotsStatus()
      setBotsStatus(latest)
      setBotsMessage(
        `Media resincronizada. Archivos nuevos: ${response?.copied ?? 0} · pool: ${response?.mediaPool?.total ?? 0}`,
      )
    } catch (error) {
      setBotsError(error instanceof Error ? error.message : 'No se pudo reimportar la media de bots.')
    } finally {
      setIsBotsBusy(false)
    }
  }

  function renderPostCell(post, options = {}) {
    const mediaUrl = typeof post?.mediaUrl === 'string' ? post.mediaUrl : ''
    const hasMedia = Boolean(mediaUrl)
    const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(mediaUrl)
    const mediaLabel = hasMedia ? (isVideo ? 'VIDEO' : 'MEDIA') : 'TEXTO'
    const createdLabel = post?.createdAt ? new Date(post.createdAt).toLocaleDateString('es-VE') : 'Reciente'

    return (
      <article className="profile-post-card" key={options.key || post.id}>
        <header className="profile-post-card-top">
          <span className={`tag ${post.tagClass || 'historia'}`}>{post.tag || 'NUEVO'}</span>
          <small>{createdLabel}</small>
        </header>

        <p>{post.caption || 'Publicacion ciudadana sin texto.'}</p>

        <footer className="profile-post-card-foot">
          <span>{post.location || 'Venezuela'}</span>
          <span>{mediaLabel}</span>
          <span>{Number(post.reactions || 0)} reacciones</span>
        </footer>
      </article>
    )
  }

  function renderActiveTab() {
    if (activeTab === 'Historias') {
      return (
        <section className="profile-tab-panel" aria-label="Historias del perfil">
          {storiesError ? <p className="route-message error">{storiesError}</p> : null}

          {stories.length ? (
            <div className="profile-story-list profile-story-list-extended">
              {stories.map((story) => (
                <article className="profile-story-item" key={story.id}>
                  <div className="profile-story-item-head">
                    <b>{story.title}</b>
                    <small>{story.reactions ?? 0} reacciones</small>
                  </div>
                  <p>{story.description || 'Sin descripcion'}</p>
                  <small>Expira: {new Date(story.expiresAt).toLocaleString('es-VE')}</small>
                </article>
              ))}
            </div>
          ) : (
            <p className="route-message">Aun no tienes historias publicadas.</p>
          )}
        </section>
      )
    }

    if (activeTab === 'Guardado') {
      return (
        <section className="profile-tab-panel" aria-label="Grabaciones de en vivo guardadas">
          <p className="route-message news-note">
            Aquí se guardan tus transmisiones en vivo por {recordingsTtlHours} horas. Después se borran solas.
          </p>

          {recordingsError ? <p className="route-message error">{recordingsError}</p> : null}
          {recordingStatus === 'subiendo' ? (
            <p className="route-message news-note">Guardando la grabación de tu último en vivo…</p>
          ) : null}

          {recordings.length ? (
            <div className="profile-recordings">
              {recordings.map((rec) => {
                const remainingH = Math.max(0, Math.round((new Date(rec.expiresAt).getTime() - Date.now()) / 3_600_000))
                return (
                  <article className="profile-recording" key={rec.id}>
                    <video className="profile-recording-video" controls preload="metadata" src={rec.mediaUrl} />
                    <div className="profile-recording-body">
                      <b>{rec.title}</b>
                      <small>
                        {rec.durationSec ? `${Math.floor(rec.durationSec / 60)}:${String(rec.durationSec % 60).padStart(2, '0')} · ` : ''}
                        {rec.visibility === 'public' ? 'Pública' : 'Privada'} · caduca en ~{remainingH} h
                      </small>
                      <button
                        className="profile-follow subtle"
                        onClick={async () => {
                          try {
                            await deleteRecording(rec.id)
                            setRecordings((current) => current.filter((item) => item.id !== rec.id))
                          } catch {
                            setRecordingsError('No se pudo borrar la grabación.')
                          }
                        }}
                        type="button"
                      >
                        Borrar ahora
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : recordingStatus !== 'subiendo' ? (
            <p className="route-message">Aún no tienes grabaciones. Haz un en vivo y se guardará aquí automáticamente.</p>
          ) : null}
        </section>
      )
    }

    if (activeTab === 'Bots') {
      return (
        <section className="profile-tab-panel" aria-label="Control de bots">
          {botsError ? <p className="route-message error">{botsError}</p> : null}
          {botsMessage ? <p className="route-message news-note">{botsMessage}</p> : null}

          <div className="panel profile-bots-panel">
            <h2>Panel de bots</h2>

            <div className="profile-bots-grid">
              <label>
                Modo de actividad
                <select
                  disabled={isBotsBusy}
                  onChange={(event) => setBotsModeDraft(event.target.value)}
                  value={botsModeDraft}
                >
                  <option value="low">Bajo</option>
                  <option value="normal">Normal</option>
                  <option value="high">Alto</option>
                </select>
              </label>

              <label>
                Rafaga de ticks
                <input
                  disabled={isBotsBusy}
                  max="20"
                  min="1"
                  onChange={(event) => setBotsBurstDraft(event.target.value)}
                  type="number"
                  value={botsBurstDraft}
                />
              </label>
            </div>

            <div className="profile-bots-actions">
              <button className="profile-follow" disabled={isBotsBusy} onClick={onChangeBotsMode} type="button">
                {isBotsBusy ? 'Aplicando...' : 'Aplicar modo'}
              </button>
              <button className="profile-follow subtle" disabled={isBotsBusy} onClick={onRunBotsBurst} type="button">
                {isBotsBusy ? 'Procesando...' : 'Ejecutar rafaga'}
              </button>
              <button className="profile-follow subtle" disabled={isBotsBusy} onClick={onReimportBotsMedia} type="button">
                {isBotsBusy ? 'Sincronizando...' : 'Reimportar media'}
              </button>
            </div>

            <div className="profile-bots-metrics">
              <article>
                <b>{botsStatus?.configuredUsers ?? 0}</b>
                <span>Bots configurados</span>
              </article>
              <article>
                <b>{botsStatus?.ticks ?? 0}</b>
                <span>Ticks acumulados</span>
              </article>
              <article>
                <b>{botsStatus?.mediaPool?.total ?? 0}</b>
                <span>Pool de media</span>
              </article>
              <article>
                <b>{botsStatus?.commentMemory?.entries ?? 0}</b>
                <span>Memoria comentarios</span>
              </article>
            </div>
          </div>
        </section>
      )
    }

    if (activeTab === 'Metricas') {
      return (
        <section className="profile-tab-panel" aria-label="Metricas personales">
          {metricsError ? <p className="route-message error">{metricsError}</p> : null}

          {isMetricsLoading ? (
            <p className="route-message">Cargando metricas...</p>
          ) : (
            <div className="profile-metrics-wrap">
              <div className="profile-metrics-cards">
                <article className="profile-metric-card">
                  <b>{metrics?.totals?.reactionsReceived ?? 0}</b>
                  <span>Reacciones recibidas</span>
                </article>
                <article className="profile-metric-card">
                  <b>{metrics?.totals?.commentsReceived ?? 0}</b>
                  <span>Comentarios recibidos</span>
                </article>
                <article className="profile-metric-card">
                  <b>{metrics?.totals?.commentsSent ?? 0}</b>
                  <span>Comentarios enviados</span>
                </article>
                <article className="profile-metric-card">
                  <b>{metrics?.totals?.activeStories ?? 0}</b>
                  <span>Historias activas</span>
                </article>
              </div>

              <div className="profile-metrics-kpis panel">
                <article>
                  <b>{metrics?.engagement?.avgReactionsPerPost ?? 0}</b>
                  <span>Promedio reacciones/post</span>
                </article>
                <article>
                  <b>{metrics?.engagement?.avgCommentsPerPost ?? 0}</b>
                  <span>Promedio comentarios/post</span>
                </article>
                <article>
                  <b>{metrics?.engagement?.publicationsPerDay ?? 0}</b>
                  <span>Publicaciones por dia</span>
                </article>
                <article>
                  <b>{metrics?.engagement?.interactions ?? 0}</b>
                  <span>Interacciones totales</span>
                </article>
              </div>

              <section className="profile-metrics-activity panel" aria-label="Actividad semanal">
                <h2>Actividad de los ultimos 7 dias</h2>

                {metricsActivity.length ? (
                  <div className="profile-metrics-rows">
                    {metricsActivity.map((entry) => {
                      const postsValue = Number(entry?.posts || 0)
                      const commentsValue = Number(entry?.comments || 0)
                      const total = postsValue + commentsValue
                      const postsWidth = total > 0 ? Math.max(10, Math.round((postsValue / maxActivity) * 100)) : 0
                      const commentsWidth = total > 0 ? Math.max(10, Math.round((commentsValue / maxActivity) * 100)) : 0

                      return (
                        <article className="profile-metrics-row" key={entry.day}>
                          <small>{entry.day}</small>
                          <div className="profile-metrics-bar">
                            <span className="posts" style={{ width: `${postsWidth}%` }} />
                            <span className="comments" style={{ width: `${commentsWidth}%` }} />
                          </div>
                          <p>{postsValue} posts / {commentsValue} comentarios</p>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <p className="route-message">Aun no hay actividad registrada en esta semana.</p>
                )}
              </section>
            </div>
          )}
        </section>
      )
    }

    if (activeTab === 'Publicaciones') {
      return (
        <section className="profile-tab-panel" aria-label="Publicaciones del perfil">
          {myPosts.length ? (
            <div className="profile-post-list">
              {myPosts.slice(0, 40).map((post) => renderPostCell(post, { key: `post-${post.id}` }))}
            </div>
          ) : (
            <section className="profile-grid" aria-label="Galeria de publicaciones">
              {profileCells.map((cell) => (
                <article className="profile-cell" key={cell.id}>
                  {cell.badge ? <span className={`tag ${cell.badgeClass}`}>{cell.badge}</span> : null}
                </article>
              ))}
            </section>
          )}
        </section>
      )
    }

    if (activeTab === 'Denuncias') {
      return (
        <section className="profile-tab-panel" aria-label="Denuncias del perfil">
          {myDenuncias.length ? (
            <div className="profile-post-list">
              {myDenuncias.slice(0, 24).map((post) => renderPostCell(post, { key: `denuncia-${post.id}` }))}
            </div>
          ) : (
            <p className="route-message">No se detectaron denuncias en tus publicaciones aun.</p>
          )}
        </section>
      )
    }

    return (
      <section className="profile-tab-panel" aria-label="Publicaciones del perfil">
        <p className="route-message">Selecciona una seccion del perfil para continuar.</p>
      </section>
    )
  }

  return (
    <section className="feed route-page profile-page">
      <div className="profile-cover">
        {user.coverUrl ? (
          <img
            alt={`Portada de ${user.displayName}`}
            className="profile-cover-img"
            loading="lazy"
            src={user.coverUrl}
          />
        ) : null}
      </div>

      <header className="profile-head panel">
        <div className="profile-head-top">
          <div className="profile-avatar-wrap">
            {user.avatarUrl ? isVideoAvatarUrl(user.avatarUrl) ? (
              <video
                autoPlay
                className="profile-avatar-video"
                loop
                muted
                playsInline
                preload="metadata"
                src={user.avatarUrl}
              />
            ) : (
              <img alt={`Avatar de ${user.displayName}`} className="profile-avatar-img" src={user.avatarUrl} />
            ) : (
              <span className="profile-avatar" aria-hidden="true" />
            )}

            <input
              accept="image/*,video/*"
              className="profile-avatar-input"
              onChange={onAvatarFile}
              ref={avatarInputRef}
              type="file"
            />

            <input
              accept="image/*"
              className="profile-avatar-input"
              onChange={onCoverFile}
              ref={coverInputRef}
              type="file"
            />

            <div className="profile-avatar-edit-wrap" ref={avatarMenuRef}>
              <button
                aria-expanded={avatarMenuOpen ? 'true' : 'false'}
                aria-label="Editar foto de perfil o portada"
                className="profile-avatar-edit"
                disabled={isAuthBusy}
                onClick={onToggleAvatarMenu}
                type="button"
              >
                Editar
              </button>

              {avatarMenuOpen ? (
                <div className="profile-avatar-submenu" role="menu">
                  <button disabled={isAuthBusy} onClick={onSelectAvatarUpload} role="menuitem" type="button">
                    Cambiar foto de perfil
                  </button>
                  <button disabled={isAuthBusy} onClick={onSelectCoverUpload} role="menuitem" type="button">
                    Cambiar foto de portada
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="profile-head-actions">
            <button
              className={`profile-private-pill ${isPrivateProfile ? 'is-private' : 'is-public'}`}
              disabled={isAuthBusy}
              onClick={onToggleProfileVisibility}
              type="button"
            >
              {isPrivateProfile ? 'Privado' : 'Publico'}
            </button>

            <div className="profile-settings-wrap" ref={settingsPanelRef}>
              <button
                aria-expanded={settingsOpen ? 'true' : 'false'}
                aria-label="Abrir ajustes de cuenta"
                className={`profile-settings-trigger ${settingsOpen ? 'is-open' : ''}`}
                onClick={onToggleSettingsPanel}
                type="button"
              >
                ⚙
              </button>

              {settingsOpen ? (
                <section className="profile-settings-panel panel" aria-label="Ajustes de cuenta">
                  <h2>Ajustes</h2>

                  {authError ? <p className="route-message error">{authError}</p> : null}
                  {profileStatus ? <p className="route-message news-note">{profileStatus}</p> : null}
                  {avatarStatus ? <p className="route-message news-note">{avatarStatus}</p> : null}
                  {coverStatus ? <p className="route-message news-note">{coverStatus}</p> : null}

                  <form className="profile-editor-form" onSubmit={onProfileSubmit}>
                    <label>
                      Nombre
                      <input
                        onChange={(event) => setDisplayNameDraft(event.target.value)}
                        value={displayNameValue}
                      />
                    </label>

                    <label>
                      Usuario
                      <input
                        onChange={(event) => setUsernameDraft(event.target.value)}
                        value={usernameValue}
                      />
                    </label>

                    <label>
                      Numero de telefono
                      <input
                        onChange={(event) => setPhoneDraft(event.target.value)}
                        placeholder="Ej: +58 412 123 4567"
                        value={phoneValue}
                      />
                    </label>

                    <label>
                      Correo
                      <input
                        onChange={(event) => setEmailDraft(event.target.value)}
                        placeholder="tu-correo@dominio.com"
                        type="email"
                        value={emailValue}
                      />
                    </label>

                    <label>
                      Biografia
                      <textarea
                        onChange={(event) => setBioDraft(event.target.value)}
                        value={bioValue}
                      />
                    </label>

                    <button className="profile-follow" disabled={isAuthBusy} type="submit">
                      {isAuthBusy ? 'Guardando...' : 'Guardar perfil'}
                    </button>
                  </form>

                  <section className="profile-theme-tools" aria-label="Modo claro u oscuro">
                    <p>Apariencia de la aplicacion</p>
                    <div className="profile-theme-switch" role="group" aria-label="Seleccionar tema">
                      <button
                        className={themeMode === 'light' ? 'active' : ''}
                        onClick={() => onSelectThemeMode('light')}
                        type="button"
                      >
                        Modo claro
                      </button>
                      <button
                        className={themeMode === 'dark' ? 'active' : ''}
                        onClick={() => onSelectThemeMode('dark')}
                        type="button"
                      >
                        Modo oscuro
                      </button>
                    </div>
                  </section>

                  <div className="profile-account-actions">
                    <button
                      className="profile-follow subtle danger"
                      onClick={onLogoutSession}
                      type="button"
                    >
                      Cerrar sesion
                    </button>
                    <button
                      className="profile-follow subtle"
                      onClick={onSwitchAccount}
                      type="button"
                    >
                      Cambiar cuenta
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </div>

        <h1>{user.displayName}</h1>
        <p className="profile-handle">
          @{user.username} - {user.emailVerified ? 'Cuenta verificada' : 'Cuenta sin verificar'}
        </p>
        <p className="profile-bio">{user.bio || 'Aun no has agregado biografia.'}</p>

        <div className="profile-stats">
          <article>
            <b>{Math.max(0, publicationCount)}</b>
            <span>Publicaciones</span>
          </article>
          <article>
            <b>{stories.length}</b>
            <span>Historias</span>
          </article>
          <article>
            <b>{reactionCount}</b>
            <span>Guardados</span>
          </article>
        </div>

        {!settingsOpen && authError ? <p className="route-message error">{authError}</p> : null}
        {!settingsOpen && profileStatus ? <p className="route-message news-note">{profileStatus}</p> : null}
        {!settingsOpen && avatarStatus ? <p className="route-message news-note">{avatarStatus}</p> : null}
        {!settingsOpen && coverStatus ? <p className="route-message news-note">{coverStatus}</p> : null}
      </header>

      {composerStatus ? <p className="route-message news-note">{composerStatus}</p> : null}

      <nav className="profile-tabs" aria-label="Secciones del perfil">
        {profileTabs.map((tab) => (
          <button
            className={activeTab === tab ? 'active' : ''}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}

        <div className="profile-create-menu">
          <button
            aria-expanded={creator === 'menu'}
            aria-label="Crear contenido"
            className="profile-create-plus"
            onClick={() => setCreator((current) => (current === 'menu' ? '' : 'menu'))}
            type="button"
          >
            +
          </button>

          {creator === 'menu' ? (
            <div className="profile-create-pop" role="menu">
              <button onClick={() => setCreator('post')} role="menuitem" type="button">
                Publicación
              </button>
              <button onClick={() => setCreator('story')} role="menuitem" type="button">
                Historia
              </button>
            </div>
          ) : null}
        </div>
      </nav>

      {renderActiveTab()}

      {creator === 'story' || creator === 'post' ? (
        <Suspense fallback={<div className="profile-create-loading">Abriendo el editor…</div>}>
          {creator === 'story' ? (
            <StoryStudio
              user={user}
              mode="story"
              onClose={() => setCreator('')}
              onPublish={async ({ mediaFile, title, description, metadata }) => {
                try {
                  const response = await createStory({
                    title: title || 'Historia',
                    description: description || '',
                    mediaFile,
                    metadata,
                  })
                  if (!response?.story) return false
                  setStories((current) => [response.story, ...current])
                  setComposerStatus('Historia publicada correctamente.')
                  return true
                } catch {
                  return false
                }
              }}
            />
          ) : (
            <PostComposer
              user={user}
              onClose={() => setCreator('')}
              onCreated={(created) => {
                if (created?.id) {
                  setLocalPosts((current) => [created, ...current.filter((item) => item.id !== created.id)])
                }
                setComposerStatus('Publicación creada correctamente.')
              }}
            />
          )}
        </Suspense>
      ) : null}
    </section>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { createPost, getPosts, updatePostReactions } from '../services/postsApi'

const POSTS_POLL_INTERVAL_MS = 60_000

/** @typedef {import('../data/feedData').Post} Post */

/**
 * @returns {{
 * posts: Post[],
 * draft: string,
 * isLoading: boolean,
 * isSubmitting: boolean,
 * errorMessage: string,
 * likedPostIds: Array<string | number>,
 * mediaFileName: string,
 * publishAsStory: boolean,
 * setDraft: (value: string) => void,
 * setMediaFile: (file: File | null) => void,
 * setPublishAsStory: (value: boolean) => void,
 * publishPost: (event: import('react').FormEvent<HTMLFormElement>) => Promise<void>,
 * toggleLike: (id: string | number) => Promise<void>
 * }}
 */
export default function usePosts({ isAuthenticated, enabled = true }) {
  const [posts, setPosts] = useState([])
  const [draft, setDraft] = useState('')
  const [mediaFile, setMediaFileState] = useState(null)
  const [mediaFileName, setMediaFileName] = useState('')
  const [publishAsStory, setPublishAsStoryState] = useState(false)
  const [likedPostIds, setLikedPostIds] = useState([])
  const [isLoading, setIsLoading] = useState(() => Boolean(enabled))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    let isMounted = true

    async function loadPosts(options = {}) {
      const isSilent = Boolean(options.silent)

      if (!isSilent) {
        setIsLoading(true)
      }

      try {
        const response = await getPosts()
        if (!isMounted) return

        setPosts(response)
        setErrorMessage('')
      } catch {
        if (!isMounted) return

        if (!isSilent) {
          setErrorMessage('No se pudieron cargar las publicaciones. Intenta recargar.')
        }
      } finally {
        if (isMounted && !isSilent) {
          setIsLoading(false)
        }
      }
    }

    void loadPosts()

    const intervalId = setInterval(() => {
      void loadPosts({ silent: true })
    }, POSTS_POLL_INTERVAL_MS)

    return () => {
      isMounted = false
      clearInterval(intervalId)
    }
  }, [enabled])

  const setMediaFile = useCallback((file) => {
    setMediaFileState(file)
    setMediaFileName(file?.name ?? '')
    if (!file) {
      setPublishAsStoryState(false)
    }
  }, [])

  const setPublishAsStory = useCallback((value) => {
    setPublishAsStoryState(Boolean(value && mediaFile))
  }, [mediaFile])

  const publishPost = useCallback(async (event) => {
    event.preventDefault()
    const text = draft.trim()

    if (!text && !mediaFile) {
      setErrorMessage('Escribe un texto o adjunta una imagen, video o audio para publicar.')
      return
    }

    if (!isAuthenticated) {
      setErrorMessage('Debes iniciar sesion para publicar.')
      return
    }

    setIsSubmitting(true)
    try {
      const newPost = await createPost({
        caption: text,
        mediaFile,
        alsoStory: Boolean(mediaFile && publishAsStory),
      })
      setPosts((current) => [newPost, ...current])
      setDraft('')
      setMediaFileState(null)
      setMediaFileName('')
      setPublishAsStoryState(false)
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo publicar en este momento. Intenta de nuevo.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [draft, isAuthenticated, mediaFile, publishAsStory])

  const toggleLike = useCallback(async (id) => {
    let currentlyLiked = false

    setLikedPostIds((current) => {
      currentlyLiked = current.includes(id)
      return currentlyLiked
        ? current.filter((item) => item !== id)
        : [...current, id]
    })

    const delta = currentlyLiked ? -1 : 1

    try {
      const updatedPost = await updatePostReactions(id, delta)
      if (!updatedPost) {
        throw new Error('No se pudo actualizar la reaccion')
      }

      setPosts((current) =>
        current.map((post) => (post.id === id ? updatedPost : post)),
      )
      setErrorMessage('')
    } catch {
      setLikedPostIds((current) =>
        currentlyLiked ? [...current, id] : current.filter((item) => item !== id),
      )
      setErrorMessage('No se pudo actualizar la reaccion. Intenta nuevamente.')
    }
  }, [])

  return {
    posts,
    draft,
    isLoading,
    isSubmitting,
    errorMessage,
    likedPostIds,
    mediaFileName,
    publishAsStory,
    setDraft,
    setMediaFile,
    setPublishAsStory,
    publishPost,
    toggleLike,
  }
}

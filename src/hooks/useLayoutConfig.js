import { useEffect, useMemo, useState } from 'react'
import {
  activityLinks,
  focusItems,
  footerLinks,
  navItems,
  stories as seedStories,
  topLinks,
  weeklyTopic,
} from '../data/feedData'
import { actualizarNoticias, getNoticias } from '../services/newsCollectorApi'
import { getStoriesFeed } from '../services/storiesApi'

const STORIES_POLL_INTERVAL_MS = 90_000
const NEWS_REFRESH_INTERVAL_MS = 8 * 60 * 1000
const MAX_HOME_STORIES = 16

function toTimestamp(value) {
  const parsed = Date.parse(typeof value === 'string' ? value : '')
  return Number.isFinite(parsed) ? parsed : 0
}

function truncateLabel(value, maxLength = 26) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return 'Historia'
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text
}

function isVideoMedia(url, mediaType = '') {
  const normalizedType = typeof mediaType === 'string' ? mediaType : ''
  if (normalizedType.startsWith('video/')) return true

  const normalizedUrl = typeof url === 'string' ? url.toLowerCase() : ''
  return /\.(mp4|webm|mov|m4v)(\?|$)/.test(normalizedUrl)
}

function mapUserStory(story) {
  const mediaUrl = typeof story?.mediaUrl === 'string' ? story.mediaUrl : ''
  const mediaType = typeof story?.mediaType === 'string' ? story.mediaType : ''

  if (!mediaUrl) return null

  const labelSource = story?.author || story?.title || 'Comunidad'

  return {
    ...story,
    id: `user-${story.id}`,
    label: truncateLabel(labelSource),
    live: isVideoMedia(mediaUrl, mediaType),
    seen: false,
    mediaUrl,
    mediaType,
    reactions: Number(story?.reactions ?? 0),
    createdAt: story?.createdAt,
    source: 'Comunidad',
  }
}

function mapNewsStory(item) {
  const mediaUrl = typeof item?.mediaUrl === 'string' ? item.mediaUrl : ''
  if (!mediaUrl) return null

  const isVideo = isVideoMedia(mediaUrl)

  return {
    id: `news-${item.id}`,
    label: truncateLabel(item?.source || 'Noticias'),
    live: isVideo,
    seen: false,
    mediaUrl,
    mediaType: isVideo ? 'video/mp4' : 'image/jpeg',
    reactions: 0,
    createdAt: item?.publishedAt,
    source: 'Noticia',
    externalUrl: typeof item?.url === 'string' ? item.url : '',
  }
}

function buildStoriesFeed(publicStories, newsItems) {
  const userStories = Array.isArray(publicStories)
    ? publicStories.map(mapUserStory).filter(Boolean)
    : []
  const rssStories = Array.isArray(newsItems)
    ? newsItems.map(mapNewsStory).filter(Boolean)
    : []

  const byId = new Map()
  for (const story of [...rssStories, ...userStories]) {
    byId.set(story.id, story)
  }

  return Array.from(byId.values())
    .sort((first, second) => toTimestamp(second.createdAt) - toTimestamp(first.createdAt))
    .slice(0, MAX_HOME_STORIES)
}

/**
 * @returns {{
 * topLinks: import('../data/feedData').TopLink[],
 * navItems: import('../data/feedData').NavItem[],
 * activityLinks: import('../data/feedData').ActivityLink[],
 * stories: import('../data/feedData').StoryItem[],
 * focusItems: import('../data/feedData').FocusItem[],
 * weeklyTopic: import('../data/feedData').WeeklyTopic,
 * footerLinks: import('../data/feedData').FooterLink[]
 * }}
 */
export default function useLayoutConfig({ enableLiveSync = true } = {}) {
  const [stories, setStories] = useState(seedStories)

  useEffect(() => {
    if (!enableLiveSync) {
      return undefined
    }

    let isMounted = true
    let isSyncing = false

    async function refreshStories(options = {}) {
      const shouldCollectRss = Boolean(options.collectRss)
      if (isSyncing) return

      isSyncing = true

      try {
        const [publicStoriesPayload, newsItems] = await Promise.all([
          getStoriesFeed().catch(() => ({ items: [] })),
          (shouldCollectRss
            ? actualizarNoticias().then((result) => result.items)
            : getNoticias()).catch(() => []),
        ])

        if (!isMounted) return

        const publicStories = Array.isArray(publicStoriesPayload?.items)
          ? publicStoriesPayload.items
          : []
        const mergedStories = buildStoriesFeed(publicStories, newsItems)

        setStories(mergedStories.length ? mergedStories : seedStories)
      } catch {
        if (!isMounted) return

        setStories((current) => (current.length ? current : seedStories))
      } finally {
        isSyncing = false
      }
    }

    void refreshStories()

    const rssBootstrapTimer = setTimeout(() => {
      void refreshStories({ collectRss: true })
    }, 800)

    const storiesTimer = setInterval(() => {
      void refreshStories()
    }, STORIES_POLL_INTERVAL_MS)

    const rssTimer = setInterval(() => {
      void refreshStories({ collectRss: true })
    }, NEWS_REFRESH_INTERVAL_MS)

    return () => {
      isMounted = false
      clearTimeout(rssBootstrapTimer)
      clearInterval(storiesTimer)
      clearInterval(rssTimer)
    }
  }, [enableLiveSync])

  return useMemo(() => {
    return {
      topLinks,
      navItems,
      activityLinks,
      stories,
      focusItems,
      weeklyTopic,
      footerLinks,
    }
  }, [stories])
}

import { httpRequest } from './httpClient'

function buildMusicLibraryPath(query, limit) {
  const params = new URLSearchParams()

  const cleanQuery = typeof query === 'string' ? query.trim() : ''
  if (cleanQuery) {
    params.set('q', cleanQuery)
  }

  const numericLimit = Number(limit)
  if (Number.isFinite(numericLimit) && numericLimit > 0) {
    params.set('limit', String(Math.min(120, Math.trunc(numericLimit))))
  }

  const queryString = params.toString()
  return queryString ? `/api/content/music-library?${queryString}` : '/api/content/music-library'
}

/**
 * @param {{ query?: string, limit?: number }} [options]
 */
export function getMusicLibrary(options = {}) {
  const query = typeof options?.query === 'string' ? options.query : ''
  const limit = options?.limit ?? 42

  return httpRequest(buildMusicLibraryPath(query, limit))
}

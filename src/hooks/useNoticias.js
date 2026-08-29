import { useCallback, useEffect, useState } from 'react'
import {
  actualizarNoticias,
  getNoticias,
  getNewsSources,
  getSourceExclusions,
  saveSourceExclusions,
} from '../services/newsCollectorApi'

/**
 * @returns {{
 * noticias: import('../services/newsCollectorApi').NewsItem[],
 * newsSources: string[],
 * sourceExclusions: Record<string, string[]>,
 * isLoading: boolean,
 * isCollecting: boolean,
 * savingSource: string,
 * errorMessage: string,
 * statusMessage: string,
 * lastUpdate: null | {
 * added: number,
 * fallback: boolean,
 * report: {
 * source: string,
 * status: 'ok' | 'error',
 * count: number,
 * strategy?: string,
 * error?: string
 * }[],
 * timestamp: string
 * },
 * reloadNoticias: () => Promise<void>,
 * collectNoticias: () => Promise<void>,
 * saveSourceKeywords: (source: string, rawKeywords: string) => Promise<string[] | null>
 * }}
 */
export default function useNoticias() {
  const [noticias, setNoticias] = useState([])
  const [newsSources] = useState(() => getNewsSources())
  const [sourceExclusions, setSourceExclusions] = useState(() => getSourceExclusions())
  const [isLoading, setIsLoading] = useState(true)
  const [isCollecting, setIsCollecting] = useState(false)
  const [savingSource, setSavingSource] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [lastUpdate, setLastUpdate] = useState(null)

  const reloadNoticias = useCallback(async () => {
    setIsLoading(true)

    try {
      const loaded = await getNoticias()
      setNoticias(loaded)
      setSourceExclusions(getSourceExclusions())
      setErrorMessage('')
    } catch {
      setErrorMessage('No se pudieron cargar las noticias guardadas.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const collectNoticias = useCallback(async () => {
    setIsCollecting(true)
    setErrorMessage('')
    setStatusMessage('')

    try {
      const result = await actualizarNoticias()
      setNoticias(result.items)
      setSourceExclusions(getSourceExclusions())
      setLastUpdate({ ...result, timestamp: new Date().toISOString() })

      const failedSources = result.report.filter((item) => item.status === 'error').length
      const suffix = failedSources ? ` (${failedSources} fuente(s) sin respuesta)` : ''

      if (result.fallback) {
        setStatusMessage(`No hubo conexion RSS en vivo. Se mantiene la data guardada.${suffix}`)
      } else if (result.added > 0) {
        setStatusMessage(`Se agregaron ${result.added} noticias nuevas.${suffix}`)
      } else {
        setStatusMessage(`No llegaron noticias nuevas en esta pasada.${suffix}`)
      }
    } catch {
      setErrorMessage('No se pudo ejecutar el recolector de noticias.')
    } finally {
      setIsCollecting(false)
    }
  }, [])

  const saveSourceKeywords = useCallback(async (source, rawKeywords) => {
    setSavingSource(source)
    setErrorMessage('')

    try {
      const savedKeywords = saveSourceExclusions(source, rawKeywords)
      setSourceExclusions((current) => ({
        ...current,
        [source]: savedKeywords,
      }))

      const loaded = await getNoticias()
      setNoticias(loaded)
      setStatusMessage(`Exclusiones actualizadas para ${source}.`)

      return savedKeywords
    } catch {
      setErrorMessage('No se pudieron guardar las exclusiones para esa fuente.')
      return null
    } finally {
      setSavingSource('')
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function bootNoticias() {
      try {
        const loaded = await getNoticias()
        if (!isMounted) return

        setNoticias(loaded)
        setSourceExclusions(getSourceExclusions())
        setErrorMessage('')
      } catch {
        if (!isMounted) return
        setErrorMessage('No se pudieron cargar las noticias guardadas.')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }

    bootNoticias()

    return () => {
      isMounted = false
    }
  }, [])

  return {
    noticias,
    newsSources,
    sourceExclusions,
    isLoading,
    isCollecting,
    savingSource,
    errorMessage,
    statusMessage,
    lastUpdate,
    reloadNoticias,
    collectNoticias,
    saveSourceKeywords,
  }
}

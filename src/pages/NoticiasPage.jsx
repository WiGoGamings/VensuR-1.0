import { useMemo, useState } from 'react'
import useNoticias from '../hooks/useNoticias'
import './Pages.css'

const RANGE_OPTIONS = [
  { id: '24h', label: '24h', hours: 24 },
  { id: '3d', label: '3 dias', hours: 72 },
  { id: '7d', label: '7 dias', hours: 168 },
  { id: 'all', label: 'Todo', hours: null },
]

function formatRelativeDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Reciente'

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60000))

  if (diffMinutes < 60) return `hace ${diffMinutes} min`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `hace ${diffHours} h`

  const diffDays = Math.floor(diffHours / 24)
  return `hace ${diffDays} d`
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'fecha no disponible'

  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function sourceClass(status) {
  return status === 'ok' ? 'ok' : 'error'
}

function reportLabel(item) {
  if (item.status !== 'ok') return 'sin respuesta'
  return `${item.count} noticias · ${item.strategy ?? 'rss'}`
}

function reportTitle(item) {
  if (item.status === 'ok') return `Fuente consultada via ${item.strategy ?? 'rss'}`
  return item.error ?? 'No fue posible consultar la fuente en esta pasada.'
}

function isWithinRange(item, activeRange) {
  if (activeRange === 'all') return true

  const range = RANGE_OPTIONS.find((option) => option.id === activeRange)
  if (!range?.hours) return true

  const timestamp = new Date(item.publishedAt).getTime()
  if (Number.isNaN(timestamp)) return false

  const threshold = Date.now() - range.hours * 60 * 60 * 1000
  return timestamp >= threshold
}

function formatCategoryLabel(value) {
  return value.replaceAll('_', ' ')
}

export default function NoticiasPage() {
  const {
    noticias,
    newsSources,
    isLoading,
    isCollecting,
    errorMessage,
    statusMessage,
    lastUpdate,
    collectNoticias,
  } = useNoticias()

  const [activeSource, setActiveSource] = useState('Todas')
  const [activeRange, setActiveRange] = useState('7d')

  const sourceFilters = useMemo(() => ['Todas', ...newsSources], [newsSources])

  const filteredNoticias = useMemo(() => {
    const sourceFiltered =
      activeSource === 'Todas'
        ? noticias
        : noticias.filter((item) => item.source === activeSource)

    return sourceFiltered.filter((item) => isWithinRange(item, activeRange))
  }, [activeSource, activeRange, noticias])

  const rangeLabel = useMemo(() => {
    return RANGE_OPTIONS.find((option) => option.id === activeRange)?.label ?? 'Todo'
  }, [activeRange])

  return (
    <section className="feed route-page news-page">
      <header className="panel news-head">
        <div>
          <h1>Recolector de noticias</h1>
          <p>
            Adaptado desde tus codigos de public para leer RSS, clasificar por tema y deduplicar por URL.
          </p>
        </div>

        <button
          className="news-refresh"
          disabled={isCollecting}
          onClick={collectNoticias}
          type="button"
        >
          {isCollecting ? 'Actualizando...' : 'Actualizar RSS'}
        </button>
      </header>

      {statusMessage ? <p className="route-message news-note">{statusMessage}</p> : null}
      {errorMessage ? <p className="route-message error">{errorMessage}</p> : null}

      {lastUpdate?.report?.length ? (
        <section className="panel news-report" aria-label="Estado por fuente">
          {lastUpdate.report.map((item) => (
            <article className="news-report-item" key={item.source}>
              <b>{item.source}</b>
              <span className={sourceClass(item.status)} title={reportTitle(item)}>
                {reportLabel(item)}
              </span>
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel news-range-panel" aria-label="Rango de tiempo">
        <h2>Rango minimo de fecha</h2>
        <div className="news-window-filters" role="tablist" aria-label="Filtro de fecha">
          {RANGE_OPTIONS.map((option) => (
            <button
              className={option.id === activeRange ? 'active' : ''}
              key={option.id}
              onClick={() => setActiveRange(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="news-tools">
        <div className="news-tools-row">
          <p>
            {filteredNoticias.length} noticias visibles · rango {rangeLabel}
            {lastUpdate ? ` · ultima pasada ${formatDateTime(lastUpdate.timestamp)}` : ''}
          </p>
        </div>

        <div className="news-filters" role="tablist" aria-label="Filtro por fuente">
          {sourceFilters.map((source) => (
            <button
              className={source === activeSource ? 'active' : ''}
              key={source}
              onClick={() => setActiveSource(source)}
              type="button"
            >
              {source}
            </button>
          ))}
        </div>
      </section>

      {isLoading ? <p className="route-message">Cargando noticias...</p> : null}

      {!isLoading && !filteredNoticias.length ? (
        <p className="route-message">No hay noticias disponibles con los filtros actuales.</p>
      ) : null}

      <div className="news-list">
        {filteredNoticias.map((item) => (
          <article className="panel news-item" key={item.id}>
            <div className="news-item-top">
              <span className="news-source">{item.source}</span>
              <time dateTime={item.publishedAt} title={formatDateTime(item.publishedAt)}>
                {formatRelativeDate(item.publishedAt)}
              </time>
            </div>

            <h2>{item.title}</h2>
            <p>{item.summary || 'Sin resumen disponible.'}</p>

            {item.mediaUrl ? (
              <img
                alt={`Imagen referencial de ${item.source}`}
                className="news-item-media"
                loading="lazy"
                src={item.mediaUrl}
              />
            ) : null}

            {item.categories?.length ? (
              <div className="news-item-categories" aria-label="Categorias detectadas">
                {item.categories.map((category) => (
                  <span className="news-item-category" key={`${item.id}-${category}`}>
                    {formatCategoryLabel(category)}
                  </span>
                ))}
              </div>
            ) : null}

            <a href={item.url} rel="noreferrer" target="_blank">
              Leer noticia original
            </a>
          </article>
        ))}
      </div>
    </section>
  )
}

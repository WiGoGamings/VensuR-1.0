import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import './Pages.css'

const filterOptions = [
  { id: 'todas', label: 'Todas' },
  { id: 'cercanas', label: 'Cercanas' },
  { id: 'verificadas', label: 'Verificadas' },
  { id: 'semana', label: 'Esta semana' },
]

const fallbackReports = [
  {
    id: 'agua-miranda',
    title: 'Escasez de agua en tres municipios',
    text: 'Reportes acumulados de cortes de agua sin aviso previo en Baruta, Chacao y El Hatillo.',
    meta: 'Hace 40 min',
    reactions: 340,
    comments: 76,
    location: 'Miranda',
    verified: true,
    nearby: false,
    thisWeek: true,
  },
  {
    id: 'energia-zulia',
    title: 'Fallas electricas prolongadas',
    text: 'Cortes de luz de mas de 6 horas reportados en zonas residenciales sin comunicacion oficial.',
    meta: 'Hace 2 h',
    reactions: 156,
    comments: 29,
    location: 'Zulia',
    verified: false,
    nearby: false,
    thisWeek: true,
  },
]

function toLiveReport(post) {
  const location = post.meta.split('·')[1]?.trim() ?? 'Venezuela'

  return {
    id: `post-${post.id}`,
    postId: post.id,
    title: 'Movimiento de colectivos reportado',
    text: post.caption,
    meta: post.meta,
    reactions: post.reactions,
    comments: post.comments,
    location,
    verified: true,
    nearby: location.toLowerCase().includes('caracas'),
    thisWeek: true,
  }
}

/**
 * @param {{
 * posts: import('../data/feedData').Post[],
 * isLoading: boolean,
 * errorMessage: string
 * }} props
 */
export default function DenunciasPage({
  posts,
  isLoading,
  errorMessage,
}) {
  const [activeFilter, setActiveFilter] = useState('todas')

  const reports = useMemo(() => {
    const liveReports = posts
      .filter((post) => post.tagClass === 'live' || post.tag.toLowerCase().includes('vivo'))
      .map(toLiveReport)

    return [...liveReports, ...fallbackReports]
  }, [posts])

  const filteredReports = useMemo(() => {
    if (activeFilter === 'cercanas') return reports.filter((item) => item.nearby)
    if (activeFilter === 'verificadas') return reports.filter((item) => item.verified)
    if (activeFilter === 'semana') return reports.filter((item) => item.thisWeek)
    return reports
  }, [activeFilter, reports])

  const loadingReports = isLoading && !reports.length

  const emptyMessage =
    activeFilter === 'cercanas'
      ? 'No hay denuncias cercanas en este momento.'
      : 'No hay denuncias activas en este momento.'

  const hasError = Boolean(errorMessage)
  const isEmpty = !loadingReports && !hasError && !filteredReports.length

  const detailPath = (postId) => (postId ? `/publicacion/${postId}` : '/publicacion')

  const footerLabel = (item) => (item.postId ? 'Ver detalle' : 'Abrir reporte')

  const footClass = (item) => (item.postId ? 'denuncias-detail-link' : 'denuncias-detail-link neutral')

  const footTarget = (item) => detailPath(item.postId)

  const isFilterActive = (id) => (id === activeFilter ? 'active' : '')

  const onFilterSelect = (id) => () => setActiveFilter(id)

  const renderReport = (item) => (
    <article className="panel denuncias-item" key={item.id}>
      <div className="denuncias-thumb" aria-hidden="true" />
      <div className="denuncias-body">
        <div className="denuncias-toprow">
          <span className="tag denuncia">DENUNCIA</span>
          <b className="denuncias-title">{item.title}</b>
          <span className="denuncias-meta">{item.meta}</span>
        </div>

        <p>{item.text}</p>

        <div className="denuncias-footrow">
          <span>❤ {item.reactions}</span>
          <span>💬 {item.comments}</span>
          <span>📍 {item.location}</span>
          <Link className={footClass(item)} to={footTarget(item)}>
            {footerLabel(item)}
          </Link>
        </div>
      </div>
    </article>
  )

  return (
    <section className="feed route-page denuncias-page">
      <header className="denuncias-head">
        <h1>Denuncias ciudadanas</h1>
        <div className="denuncias-filters" role="tablist" aria-label="Filtros de denuncias">
          {filterOptions.map((option) => (
            <button
              className={isFilterActive(option.id)}
              key={option.id}
              onClick={onFilterSelect(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {loadingReports ? <p className="route-message">Cargando denuncias...</p> : null}
      {hasError ? <p className="route-message error">{errorMessage}</p> : null}

      {isEmpty ? <p className="route-message">{emptyMessage}</p> : null}

      <div className="denuncias-list">{filteredReports.map(renderReport)}</div>
    </section>
  )
}

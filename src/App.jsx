import { Suspense, lazy, useMemo } from 'react'
import FooterBar from './components/layout/FooterBar'
import LeftRail from './components/layout/LeftRail'
import RightRail from './components/layout/RightRail'
import TopBar from './components/layout/TopBar'
import { useAuth } from './contexts/AuthContext'
import useLayoutConfig from './hooks/useLayoutConfig'
import useNotifications from './hooks/useNotifications'
import usePosts from './hooks/usePosts'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './App.css'

const AccesoPage = lazy(() => import('./pages/AccesoPage'))
const DenunciasPage = lazy(() => import('./pages/DenunciasPage'))
const ExplorarPage = lazy(() => import('./pages/ExplorarPage'))
const HistoriasPage = lazy(() => import('./pages/HistoriasPage'))
const InicioPage = lazy(() => import('./pages/InicioPage'))
const NoticiasPage = lazy(() => import('./pages/NoticiasPage'))
const PerfilPage = lazy(() => import('./pages/PerfilPage'))
const PublicacionPage = lazy(() => import('./pages/PublicacionPage'))
const UsuarioPage = lazy(() => import('./pages/UsuarioPage'))
const VivoPage = lazy(() => import('./pages/VivoPage'))
const SalaEnVivoPage = lazy(() => import('./pages/SalaEnVivoPage'))
const LiveOverlays = lazy(() => import('./components/live/LiveOverlays'))

function isPathMatch(pathname, matcher) {
  return pathname === matcher || pathname.startsWith(`${matcher}/`)
}

function App() {
  const location = useLocation()
  const pathname = location.pathname
  const showRightRail = location.pathname === '/'
  const { user, isAuthenticated, isBooting, logout } = useAuth()
  const needsPosts = useMemo(() => {
    return ['/perfil', '/usuario', '/denuncias', '/publicacion', '/'].some((path) => isPathMatch(pathname, path))
  }, [pathname])
  const needsStoriesSync = useMemo(() => {
    return ['/historias', '/'].some((path) => isPathMatch(pathname, path))
  }, [pathname])

  const {
    topLinks,
    navItems,
    activityLinks,
    stories,
    focusItems,
    weeklyTopic,
    footerLinks,
  } = useLayoutConfig({ enableLiveSync: needsStoriesSync })

  const {
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
  } = usePosts({ isAuthenticated, enabled: needsPosts })

  const {
    notifications,
    unreadCount,
    isLoading: isNotificationsLoading,
    errorMessage: notificationsError,
    refreshNotifications,
    markAllAsRead,
  } = useNotifications({ isAuthenticated, enabled: true })

  const loadingRouteFallback = (
    <section className="feed route-page">
      <p className="route-message">Cargando pagina...</p>
    </section>
  )

  return (
    <main className="app-shell">
      <div className="flagbar" />

      <TopBar
        links={topLinks}
        currentUser={user}
        onLogout={logout}
        notifications={notifications}
        unreadNotifications={unreadCount}
        isNotificationsLoading={isNotificationsLoading}
        notificationsError={notificationsError}
        onRefreshNotifications={refreshNotifications}
        onMarkAllNotificationsRead={markAllAsRead}
      />

      <div className={`layout ${showRightRail ? '' : 'layout-expanded'}`.trim()} id="top">
        <LeftRail items={navItems} activityLinks={activityLinks} currentUser={user} />

        <Suspense fallback={loadingRouteFallback}>
          <Routes>
            <Route
              path="/"
              element={
                <InicioPage
                  stories={stories}
                  posts={posts}
                  draft={draft}
                  isLoading={isLoading}
                  errorMessage={errorMessage}
                  isSubmitting={isSubmitting}
                  onDraftChange={setDraft}
                  mediaFileName={mediaFileName}
                  publishAsStory={publishAsStory}
                  onMediaSelect={setMediaFile}
                  onPublishAsStoryChange={setPublishAsStory}
                  isAuthenticated={isAuthenticated}
                  onSubmit={publishPost}
                  likedPostIds={likedPostIds}
                  onToggleLike={toggleLike}
                />
              }
            />
            <Route path="/acceso" element={<AccesoPage />} />
            <Route path="/historias/:storyId?" element={<HistoriasPage stories={stories} />} />
            <Route path="/noticias" element={<NoticiasPage />} />
            <Route path="/explorar" element={<ExplorarPage />} />
            <Route
              path="/denuncias"
              element={
                <DenunciasPage
                  posts={posts}
                  isLoading={isLoading}
                  errorMessage={errorMessage}
                />
              }
            />
            <Route path="/vivo" element={<VivoPage />} />
            <Route path="/directo/:sessionId" element={<SalaEnVivoPage />} />
            <Route
              path="/perfil"
              element={
                isBooting ? (
                  <section className="feed route-page">
                    <p className="route-message">Verificando sesion...</p>
                  </section>
                ) : isAuthenticated ? (
                  <PerfilPage posts={posts} />
                ) : (
                  <Navigate to="/acceso" replace state={{ from: location.pathname }} />
                )
              }
            />
            <Route
              path="/publicacion/:postId?"
              element={<PublicacionPage posts={posts} isLoading={isLoading} />}
            />
            <Route
              path="/usuario/:username"
              element={<UsuarioPage posts={posts} isLoading={isLoading} />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>

        {showRightRail ? <RightRail focusItems={focusItems} topic={weeklyTopic} /> : null}
      </div>

      <FooterBar links={footerLinks} />

      <Suspense fallback={null}>
        <LiveOverlays />
      </Suspense>
    </main>
  )
}

export default App

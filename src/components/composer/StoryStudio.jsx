import './StoryStudio.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMusicLibrary } from '../../services/musicApi'
import {
  PHOTO_FILTERS,
  TEXT_BACKGROUNDS,
  TEXT_COLORS,
  TEXT_FONTS,
  blobToFile,
  buildFilterCss,
  clamp,
  createTextLayer,
  defaultAdjustments,
  getBackgroundById,
  getFontById,
  loadImageFromFile,
  nowClockLabel,
  renderStoryToBlob,
} from './storyAssets'

const ADJUST_CONTROLS = [
  { key: 'brightness', label: 'Brillo', min: 0.6, max: 1.5, step: 0.01 },
  { key: 'contrast', label: 'Contraste', min: 0.6, max: 1.6, step: 0.01 },
  { key: 'saturation', label: 'Saturación', min: 0, max: 2, step: 0.01 },
  { key: 'warmth', label: 'Calidez', min: -1, max: 1, step: 0.02 },
  { key: 'vignette', label: 'Viñeta', min: 0, max: 0.8, step: 0.02 },
  { key: 'blur', label: 'Desenfoque', min: 0, max: 6, step: 0.1 },
]

function initialsOf(user) {
  const source = user?.displayName || user?.username || 'VR'
  return source.slice(0, 2).toUpperCase()
}

/**
 * Editor visual estilo Facebook / Instagram para historias y publicaciones.
 * @param {{
 *  user: any,
 *  mode?: 'story' | 'post',
 *  initialFile?: File | null,
 *  onClose: () => void,
 *  onPublish: (payload: {
 *    mediaFile: File | null,
 *    title: string,
 *    description: string,
 *    metadata: object
 *  }) => Promise<boolean>
 * }} props
 */
export default function StoryStudio({ user, mode = 'story', initialFile = null, onClose, onPublish }) {
  const isPost = mode === 'post'
  const [step, setStep] = useState(initialFile ? 'editMedia' : 'choose')

  // --- Estado del editor de foto/video ---
  const [sourceFile, setSourceFile] = useState(null)
  const [sourceKind, setSourceKind] = useState('image')
  const [imageEl, setImageEl] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const previewUrlRef = useRef('')

  const [filterId, setFilterId] = useState('normal')
  const [adjust, setAdjust] = useState(defaultAdjustments)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [textLayers, setTextLayers] = useState([])
  const [activeLayerId, setActiveLayerId] = useState('')
  const [showClock, setShowClock] = useState(false)
  const [description, setDescription] = useState('')
  const [panel, setPanel] = useState('')

  // --- Música ---
  const [musicTracks, setMusicTracks] = useState([])
  const [musicQuery, setMusicQuery] = useState('')
  const [musicLoading, setMusicLoading] = useState(false)
  const [selectedTrack, setSelectedTrack] = useState(null)
  const [musicStart, setMusicStart] = useState(0)
  const musicAudioRef = useRef(null)

  // --- Estado del editor de texto ---
  const [textBgId, setTextBgId] = useState('azul')
  const [textValue, setTextValue] = useState('')
  const [textFontId, setTextFontId] = useState('fuerte')
  const [textColor, setTextColor] = useState('#ffffff')
  const [textAlign, setTextAlign] = useState('center')

  const [isPublishing, setIsPublishing] = useState(false)
  const [error, setError] = useState('')

  const stageRef = useRef(null)
  const dragStateRef = useRef(null)
  const fileInputRef = useRef(null)

  const clockLabel = useMemo(() => nowClockLabel(), [])
  const filterCss = useMemo(() => buildFilterCss(filterId, adjust), [filterId, adjust])
  const activeLayer = textLayers.find((layer) => layer.id === activeLayerId) || null

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  const resetEditorState = useCallback(() => {
    setFilterId('normal')
    setAdjust(defaultAdjustments())
    setZoom(1)
    setRotation(0)
    setTextLayers([])
    setActiveLayerId('')
    setShowClock(false)
    setDescription('')
    setPanel('')
    setSelectedTrack(null)
    setMusicStart(0)
    setError('')
  }, [])

  const loadMusic = useCallback(async (query = '') => {
    setMusicLoading(true)
    try {
      const payload = await getMusicLibrary({ query: query.trim(), limit: 40 })
      setMusicTracks(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setMusicTracks([])
    } finally {
      setMusicLoading(false)
    }
  }, [])

  const onPickFile = useCallback(async (file) => {
    if (!file) return
    setError('')

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = ''
    }

    const kind = file.type.startsWith('video/') ? 'video' : 'image'
    setSourceFile(file)
    setSourceKind(kind)
    resetEditorState()

    if (kind === 'image') {
      try {
        const { image, url } = await loadImageFromFile(file)
        previewUrlRef.current = url
        setImageEl(image)
        setPreviewUrl(url)
      } catch {
        setError('No se pudo abrir la imagen. Prueba con otra.')
        return
      }
    } else {
      const url = URL.createObjectURL(file)
      previewUrlRef.current = url
      setImageEl(null)
      setPreviewUrl(url)
    }

    setStep('editMedia')
  }, [resetEditorState])

  useEffect(() => {
    if (!initialFile) return undefined
    let cancelled = false
    void (async () => {
      if (!cancelled) await onPickFile(initialFile)
    })()
    return () => {
      cancelled = true
    }
  }, [initialFile, onPickFile])

  // --- Arrastrar textos ---
  const onLayerPointerDown = (event, layerId) => {
    event.stopPropagation()
    setActiveLayerId(layerId)
    setPanel('text')
    const layer = textLayers.find((item) => item.id === layerId)
    if (!layer) return
    dragStateRef.current = {
      layerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: layer.xPct,
      originY: layer.yPct,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onLayerPointerMove = (event) => {
    const drag = dragStateRef.current
    const stage = stageRef.current
    if (!drag || !stage) return
    const rect = stage.getBoundingClientRect()
    const dxPct = ((event.clientX - drag.startX) / rect.width) * 100
    const dyPct = ((event.clientY - drag.startY) / rect.height) * 100
    setTextLayers((layers) =>
      layers.map((layer) =>
        layer.id === drag.layerId
          ? { ...layer, xPct: clamp(drag.originX + dxPct, 6, 94, 50), yPct: clamp(drag.originY + dyPct, 6, 94, 50) }
          : layer,
      ),
    )
  }

  const onLayerPointerUp = () => {
    dragStateRef.current = null
  }

  const addTextLayer = () => {
    const layer = createTextLayer({ text: '' })
    setTextLayers((layers) => [...layers, layer])
    setActiveLayerId(layer.id)
    setPanel('text')
  }

  const updateActiveLayer = (patch) => {
    if (!activeLayerId) return
    setTextLayers((layers) => layers.map((layer) => (layer.id === activeLayerId ? { ...layer, ...patch } : layer)))
  }

  const removeActiveLayer = () => {
    if (!activeLayerId) return
    setTextLayers((layers) => layers.filter((layer) => layer.id !== activeLayerId))
    setActiveLayerId('')
  }

  const openPanel = (name) => {
    setPanel((current) => (current === name ? '' : name))
    if (name === 'music' && !musicTracks.length) void loadMusic('')
    if (name === 'text' && !textLayers.length) addTextLayer()
  }

  const chooseTrack = (track) => {
    setSelectedTrack((current) => (current?.id === track.id ? null : track))
    setMusicStart(0)
  }

  useEffect(() => {
    const audio = musicAudioRef.current
    if (!audio) return
    if (selectedTrack?.previewUrl) {
      audio.src = selectedTrack.previewUrl
      audio.currentTime = musicStart
      audio.volume = 0.8
      void audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }, [selectedTrack, musicStart])

  const closeStudio = () => {
    musicAudioRef.current?.pause()
    onClose()
  }

  // --- Publicar ---
  const publishMediaStory = async () => {
    if (isPublishing) return
    setIsPublishing(true)
    setError('')
    musicAudioRef.current?.pause()

    try {
      const firstText = textLayers.map((layer) => layer.text.trim()).find(Boolean) || ''
      const title = (firstText || 'Historia').slice(0, 80)
      const music = selectedTrack
        ? { trackId: selectedTrack.id, startSeconds: Math.round(musicStart), volume: 0.85 }
        : null

      let mediaFile = sourceFile
      let metadata = isPost ? {} : { music }

      if (sourceKind === 'image' && imageEl) {
        const blob = await renderStoryToBlob({
          image: imageEl,
          filterCss,
          adjust,
          zoom,
          rotation,
          textLayers,
          clockLabel: showClock ? clockLabel : '',
          width: 1080,
          height: isPost ? 1350 : 1920,
        })
        mediaFile = blobToFile(blob, `${isPost ? 'publicacion' : 'historia'}-${Date.now()}.jpg`)
      } else {
        // Video: no se puede "hornear"; se guarda metadata para renderizar al reproducir.
        const layer = textLayers.find((item) => item.text.trim()) || null
        metadata = {
          music,
          editor: {
            overlayText: layer ? layer.text.trim().slice(0, 180) : '',
            textColor: layer?.color || '#ffffff',
            textSize: layer ? clamp(Math.round((layer.sizePct / 100) * 380), 18, 58, 34) : 34,
            textPositionY: layer ? clamp(layer.yPct, 10, 86, 72) : 72,
            textAlign: layer?.align || 'center',
            filter: filterId === 'normal' ? 'none' : filterId,
            showClock,
            clockLabel: showClock ? clockLabel : '',
          },
        }
      }

      const ok = await onPublish(
        isPost
          ? { mediaFile, title: '', description: '', metadata: {} }
          : { mediaFile, title, description: description.trim(), metadata },
      )
      if (ok) closeStudio()
      else setError(`No se pudo publicar la ${isPost ? 'publicación' : 'historia'}. Intenta de nuevo.`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo publicar la historia.')
    } finally {
      setIsPublishing(false)
    }
  }

  const publishTextStory = async () => {
    if (isPublishing) return
    const value = textValue.trim()
    if (!value) {
      setError('Escribe algo para tu historia de texto.')
      return
    }

    setIsPublishing(true)
    setError('')

    try {
      const layer = createTextLayer({
        text: value,
        color: textColor,
        fontId: textFontId,
        align: textAlign,
        sizePct: value.length > 90 ? 6 : value.length > 40 ? 8 : 11,
        yPct: 50,
      })
      const blob = await renderStoryToBlob({
        backgroundCss: getBackgroundById(textBgId).css,
        textLayers: [layer],
      })
      const mediaFile = blobToFile(blob, `historia-texto-${Date.now()}.jpg`)
      const ok = await onPublish({
        mediaFile,
        title: value.slice(0, 80),
        description: '',
        metadata: { music: null },
      })
      if (ok) closeStudio()
      else setError('No se pudo publicar la historia.')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo publicar la historia.')
    } finally {
      setIsPublishing(false)
    }
  }

  // ----------------------------------------------------------------
  //  RENDER
  // ----------------------------------------------------------------

  if (step === 'choose') {
    return (
      <div className="story-studio-backdrop" role="dialog" aria-modal="true" aria-label="Crear historia">
        <div className="story-studio choose">
          <header className="story-studio-choose-head">
            <button className="story-studio-x" onClick={closeStudio} type="button" aria-label="Cerrar">✕</button>
            <span className="story-studio-brand" aria-hidden="true"><i /><i /><i /></span>
          </header>

          <div className="story-choose-cards">
            <button
              className="story-choose-card media"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <span className="story-choose-icon">🖼️</span>
              <b>Crear una historia con foto o video</b>
            </button>

            <button
              className="story-choose-card text"
              onClick={() => {
                resetEditorState()
                setTextValue('')
                setStep('editText')
              }}
              type="button"
            >
              <span className="story-choose-icon">Aa</span>
              <b>Crear una historia de texto</b>
            </button>
          </div>

          <input
            accept="image/*,video/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void onPickFile(file)
            }}
            ref={fileInputRef}
            type="file"
          />
        </div>
      </div>
    )
  }

  if (step === 'editText') {
    const font = getFontById(textFontId)
    return (
      <div className="story-studio-backdrop" role="dialog" aria-modal="true" aria-label="Historia de texto">
        <div className="story-studio">
          <aside className="story-studio-rail">
            <header className="story-studio-rail-head">
              <button className="story-studio-back" onClick={() => setStep('choose')} type="button">‹ Atrás</button>
              <h2>Tu historia</h2>
            </header>

            <div className="story-studio-user">
              <span className="story-studio-avatar">{initialsOf(user)}</span>
              <b>{user?.displayName || user?.username || 'Tú'}</b>
            </div>

            <div className="story-studio-panel">
              <label className="story-field">
                Texto
                <textarea
                  autoFocus
                  maxLength={280}
                  onChange={(event) => setTextValue(event.target.value)}
                  placeholder="Escribe algo..."
                  value={textValue}
                />
              </label>

              <span className="story-field-label">Fondo</span>
              <div className="story-swatch-row">
                {TEXT_BACKGROUNDS.map((bg) => (
                  <button
                    aria-label={bg.id}
                    className={`story-swatch ${textBgId === bg.id ? 'on' : ''}`}
                    key={bg.id}
                    onClick={() => setTextBgId(bg.id)}
                    style={{ background: bg.css }}
                    type="button"
                  />
                ))}
              </div>

              <span className="story-field-label">Fuente</span>
              <div className="story-chip-row">
                {TEXT_FONTS.map((item) => (
                  <button
                    className={`story-chip ${textFontId === item.id ? 'on' : ''}`}
                    key={item.id}
                    onClick={() => setTextFontId(item.id)}
                    style={{ fontFamily: item.stack }}
                    type="button"
                  >
                    {item.name}
                  </button>
                ))}
              </div>

              <span className="story-field-label">Color</span>
              <div className="story-swatch-row">
                {TEXT_COLORS.map((color) => (
                  <button
                    aria-label={color}
                    className={`story-swatch small ${textColor === color ? 'on' : ''}`}
                    key={color}
                    onClick={() => setTextColor(color)}
                    style={{ background: color }}
                    type="button"
                  />
                ))}
              </div>

              <span className="story-field-label">Alineación</span>
              <div className="story-chip-row">
                {['left', 'center', 'right'].map((value) => (
                  <button
                    className={`story-chip ${textAlign === value ? 'on' : ''}`}
                    key={value}
                    onClick={() => setTextAlign(value)}
                    type="button"
                  >
                    {value === 'left' ? 'Izq.' : value === 'center' ? 'Centro' : 'Der.'}
                  </button>
                ))}
              </div>
            </div>

            {error ? <p className="story-studio-error">{error}</p> : null}

            <footer className="story-studio-foot">
              <button className="story-btn ghost" onClick={closeStudio} type="button">Descartar</button>
              <button className="story-btn primary" disabled={isPublishing} onClick={publishTextStory} type="button">
                {isPublishing ? 'Publicando...' : 'Compartir en historia'}
              </button>
            </footer>
          </aside>

          <section className="story-studio-preview">
            <span className="story-studio-preview-label">Vista previa</span>
            <div className="story-stage-wrap">
              <div className="story-stage text-story" style={{ background: getBackgroundById(textBgId).css }}>
                <p
                  className={`story-text-story-body align-${textAlign}`}
                  style={{ color: textColor, fontFamily: font.stack, fontWeight: font.weight }}
                >
                  {textValue || 'Tu texto aparecerá aquí'}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  // step === 'editMedia'
  const railActions = [
    { key: 'text', icon: 'Aa', label: 'Agregar texto' },
    { key: 'filters', icon: '✨', label: 'Filtros y efectos' },
    !isPost && { key: 'music', icon: '♪', label: 'Agregar música' },
    !isPost && { key: 'clock', icon: '🕒', label: showClock ? 'Quitar hora' : 'Agregar hora' },
    { key: 'crop', icon: '⟳', label: 'Girar y zoom' },
  ].filter(Boolean)

  return (
    <div className="story-studio-backdrop" role="dialog" aria-modal="true" aria-label="Editar historia">
      <div className="story-studio">
        <aside className="story-studio-rail">
          <header className="story-studio-rail-head">
            <button
              className="story-studio-back"
              onClick={() => (initialFile ? closeStudio() : setStep('choose'))}
              type="button"
            >
              ‹ Atrás
            </button>
            <h2>{isPost ? 'Tu publicación' : 'Tu historia'}</h2>
          </header>

          <div className="story-studio-user">
            <span className="story-studio-avatar">
              {user?.avatarUrl ? <img alt="" src={user.avatarUrl} /> : initialsOf(user)}
            </span>
            <b>{user?.displayName || user?.username || 'Tú'}</b>
          </div>

          {!panel ? (
            <nav className="story-rail-actions">
              {railActions.map((action) => (
                <button
                  className="story-rail-action"
                  key={action.key}
                  onClick={() => {
                    if (action.key === 'clock') {
                      setShowClock((value) => !value)
                      return
                    }
                    openPanel(action.key)
                  }}
                  type="button"
                >
                  <span className="story-rail-action-icon">{action.icon}</span>
                  {action.label}
                </button>
              ))}

              <label className="story-field alt">
                Texto alternativo (descripción)
                <textarea
                  maxLength={280}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe la historia para más contexto"
                  value={description}
                />
              </label>
            </nav>
          ) : (
            <div className="story-studio-panel">
              <button className="story-studio-back small" onClick={() => setPanel('')} type="button">‹ Listo</button>

              {panel === 'text' ? (
                <>
                  <button className="story-btn subtle" onClick={addTextLayer} type="button">+ Agregar otro texto</button>
                  {!activeLayer ? (
                    <p className="story-hint">Toca un texto en la vista previa para editarlo.</p>
                  ) : (
                    <>
                      <label className="story-field">
                        Contenido
                        <textarea
                          autoFocus
                          maxLength={180}
                          onChange={(event) => updateActiveLayer({ text: event.target.value })}
                          placeholder="Escribe aquí"
                          value={activeLayer.text}
                        />
                      </label>

                      <span className="story-field-label">Fuente</span>
                      <div className="story-chip-row">
                        {TEXT_FONTS.map((item) => (
                          <button
                            className={`story-chip ${activeLayer.fontId === item.id ? 'on' : ''}`}
                            key={item.id}
                            onClick={() => updateActiveLayer({ fontId: item.id })}
                            style={{ fontFamily: item.stack }}
                            type="button"
                          >
                            {item.name}
                          </button>
                        ))}
                      </div>

                      <span className="story-field-label">Color</span>
                      <div className="story-swatch-row">
                        {TEXT_COLORS.map((color) => (
                          <button
                            aria-label={color}
                            className={`story-swatch small ${activeLayer.color === color ? 'on' : ''}`}
                            key={color}
                            onClick={() => updateActiveLayer({ color })}
                            style={{ background: color }}
                            type="button"
                          />
                        ))}
                      </div>

                      <label className="story-field">
                        Tamaño
                        <input
                          max={20}
                          min={4}
                          onChange={(event) => updateActiveLayer({ sizePct: Number(event.target.value) })}
                          step={0.5}
                          type="range"
                          value={activeLayer.sizePct}
                        />
                      </label>

                      <div className="story-chip-row">
                        {['left', 'center', 'right'].map((value) => (
                          <button
                            className={`story-chip ${activeLayer.align === value ? 'on' : ''}`}
                            key={value}
                            onClick={() => updateActiveLayer({ align: value })}
                            type="button"
                          >
                            {value === 'left' ? 'Izq.' : value === 'center' ? 'Centro' : 'Der.'}
                          </button>
                        ))}
                        <button
                          className={`story-chip ${activeLayer.background ? 'on' : ''}`}
                          onClick={() => updateActiveLayer({ background: !activeLayer.background })}
                          type="button"
                        >
                          Fondo
                        </button>
                      </div>

                      <button className="story-btn ghost danger" onClick={removeActiveLayer} type="button">
                        Eliminar este texto
                      </button>
                    </>
                  )}
                </>
              ) : null}

              {panel === 'filters' ? (
                <>
                  <div className="story-filter-strip">
                    {PHOTO_FILTERS.map((preset) => (
                      <button
                        className={`story-filter-thumb ${filterId === preset.id ? 'on' : ''}`}
                        key={preset.id}
                        onClick={() => setFilterId(preset.id)}
                        type="button"
                      >
                        <span
                          className="story-filter-thumb-img"
                          style={{
                            backgroundImage: previewUrl && sourceKind === 'image' ? `url(${previewUrl})` : undefined,
                            filter: preset.css || 'none',
                          }}
                        />
                        {preset.name}
                      </button>
                    ))}
                  </div>

                  {ADJUST_CONTROLS.map((control) => (
                    <label className="story-field" key={control.key}>
                      {control.label}
                      <input
                        max={control.max}
                        min={control.min}
                        onChange={(event) =>
                          setAdjust((current) => ({ ...current, [control.key]: Number(event.target.value) }))
                        }
                        step={control.step}
                        type="range"
                        value={adjust[control.key]}
                      />
                    </label>
                  ))}
                  <button
                    className="story-btn subtle"
                    onClick={() => {
                      setAdjust(defaultAdjustments())
                      setFilterId('normal')
                    }}
                    type="button"
                  >
                    Restablecer
                  </button>
                </>
              ) : null}

              {panel === 'music' ? (
                <>
                  <div className="story-music-search">
                    <input
                      onChange={(event) => setMusicQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void loadMusic(musicQuery)
                      }}
                      placeholder="Buscar canción, artista o estado"
                      value={musicQuery}
                    />
                    <button className="story-btn subtle" onClick={() => void loadMusic(musicQuery)} type="button">
                      Buscar
                    </button>
                  </div>

                  {musicLoading ? <p className="story-hint">Cargando música...</p> : null}

                  <div className="story-music-list">
                    {musicTracks.map((track) => (
                      <button
                        className={`story-music-item ${selectedTrack?.id === track.id ? 'on' : ''}`}
                        key={track.id}
                        onClick={() => chooseTrack(track)}
                        type="button"
                      >
                        <span className="story-music-note">♪</span>
                        <span className="story-music-meta">
                          <b>{track.title}</b>
                          <small>{[track.artist, track.mood].filter(Boolean).join(' · ') || 'Comunidad'}</small>
                        </span>
                        {selectedTrack?.id === track.id ? <span className="story-music-check">✓</span> : null}
                      </button>
                    ))}
                    {!musicLoading && !musicTracks.length ? (
                      <p className="story-hint">Sin resultados. Prueba otra búsqueda.</p>
                    ) : null}
                  </div>

                  {selectedTrack ? (
                    <label className="story-field">
                      Empezar en {Math.round(musicStart)}s
                      <input
                        max={Math.max(1, (selectedTrack.durationSec || 30) - 1)}
                        min={0}
                        onChange={(event) => setMusicStart(Number(event.target.value))}
                        step={1}
                        type="range"
                        value={musicStart}
                      />
                    </label>
                  ) : null}
                </>
              ) : null}

              {panel === 'crop' ? (
                <>
                  <label className="story-field">
                    Zoom {zoom.toFixed(1)}x
                    <input
                      max={3}
                      min={1}
                      onChange={(event) => setZoom(Number(event.target.value))}
                      step={0.05}
                      type="range"
                      value={zoom}
                    />
                  </label>
                  <button
                    className="story-btn subtle"
                    onClick={() => setRotation((value) => (value + 90) % 360)}
                    type="button"
                  >
                    ⟳ Girar 90°
                  </button>
                  <button
                    className="story-btn subtle"
                    onClick={() => {
                      setZoom(1)
                      setRotation(0)
                    }}
                    type="button"
                  >
                    Restablecer encuadre
                  </button>
                </>
              ) : null}
            </div>
          )}

          {error ? <p className="story-studio-error">{error}</p> : null}

          <footer className="story-studio-foot">
            <button className="story-btn ghost" onClick={closeStudio} type="button">Descartar</button>
            <button className="story-btn primary" disabled={isPublishing} onClick={publishMediaStory} type="button">
              {isPublishing
                ? 'Publicando...'
                : isPost
                  ? 'Compartir publicación'
                  : 'Compartir en historia'}
            </button>
          </footer>
        </aside>

        <section className="story-studio-preview">
          <span className="story-studio-preview-label">Vista previa</span>
          <div className="story-stage-wrap">
            <div
              className={`story-stage ${isPost ? 'post-stage' : ''}`}
              onPointerMove={onLayerPointerMove}
              onPointerUp={onLayerPointerUp}
              ref={stageRef}
            >
              {sourceKind === 'video' ? (
                <video
                  autoPlay
                  className="story-stage-media"
                  loop
                  muted
                  playsInline
                  src={previewUrl}
                  style={{ filter: filterCss, transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                />
              ) : previewUrl ? (
                <img
                  alt=""
                  className="story-stage-media"
                  src={previewUrl}
                  style={{ filter: filterCss, transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                />
              ) : null}

              {adjust.vignette > 0 ? (
                <span
                  className="story-stage-vignette"
                  style={{ boxShadow: `inset 0 0 ${120 + adjust.vignette * 220}px rgba(0,0,0,${adjust.vignette})` }}
                />
              ) : null}

              {showClock ? <span className="story-stage-clock">{clockLabel}</span> : null}

              {textLayers.map((layer) => {
                const font = getFontById(layer.fontId)
                return (
                  <div
                    className={`story-stage-text align-${layer.align} ${layer.background ? 'has-bg' : ''} ${
                      activeLayerId === layer.id ? 'active' : ''
                    }`}
                    key={layer.id}
                    onPointerDown={(event) => onLayerPointerDown(event, layer.id)}
                    style={{
                      left: `${layer.xPct}%`,
                      top: `${layer.yPct}%`,
                      color: layer.color,
                      fontFamily: font.stack,
                      fontWeight: font.weight,
                      fontSize: `calc(${layer.sizePct} * 0.5vh)`,
                    }}
                  >
                    {layer.text || 'Escribe...'}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="story-stage-tools">
            <button className="story-tool" onClick={() => setZoom((v) => clamp(v - 0.1, 1, 3, 1))} type="button">−</button>
            <input
              max={3}
              min={1}
              onChange={(event) => setZoom(Number(event.target.value))}
              step={0.05}
              type="range"
              value={zoom}
            />
            <button className="story-tool" onClick={() => setZoom((v) => clamp(v + 0.1, 1, 3, 1))} type="button">+</button>
            <button
              className="story-tool wide"
              onClick={() => setRotation((value) => (value + 90) % 360)}
              type="button"
            >
              ⟳ Girar
            </button>
          </div>
        </section>
      </div>

      <audio hidden loop ref={musicAudioRef} />
    </div>
  )
}

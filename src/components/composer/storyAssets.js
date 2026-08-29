// Recursos y utilidades compartidas del creador de historias (estilo Facebook / Instagram).

export const STORY_ASPECT = 9 / 16
export const STORY_RENDER_WIDTH = 1080
export const STORY_RENDER_HEIGHT = 1920

/** Filtros tipo Instagram. `css` sirve tanto para CSS del DOM como para ctx.filter del canvas. */
export const PHOTO_FILTERS = [
  { id: 'normal', name: 'Normal', css: '' },
  { id: 'clarendon', name: 'Clarendon', css: 'contrast(1.15) saturate(1.35) brightness(1.05)' },
  { id: 'gingham', name: 'Gingham', css: 'sepia(0.12) contrast(0.9) brightness(1.08)' },
  { id: 'moon', name: 'Moon', css: 'grayscale(1) contrast(1.1) brightness(1.1)' },
  { id: 'lark', name: 'Lark', css: 'saturate(1.2) brightness(1.08) contrast(0.95)' },
  { id: 'reyes', name: 'Reyes', css: 'sepia(0.35) contrast(0.85) brightness(1.1) saturate(0.9)' },
  { id: 'juno', name: 'Juno', css: 'saturate(1.4) contrast(1.05) sepia(0.1) hue-rotate(-8deg)' },
  { id: 'slumber', name: 'Slumber', css: 'saturate(0.66) brightness(1.05) sepia(0.2)' },
  { id: 'crema', name: 'Crema', css: 'sepia(0.2) contrast(1.05) brightness(1.02) saturate(0.9)' },
  { id: 'ludwig', name: 'Ludwig', css: 'saturate(1.1) contrast(1.05) brightness(1.05) sepia(0.08)' },
  { id: 'aden', name: 'Aden', css: 'hue-rotate(-15deg) contrast(0.9) saturate(0.85) brightness(1.1)' },
  { id: 'perpetua', name: 'Perpetua', css: 'contrast(1.05) brightness(1.05) saturate(1.1) hue-rotate(5deg)' },
]

/** Fondos degradados para historias de solo texto (estilo Facebook). */
export const TEXT_BACKGROUNDS = [
  { id: 'azul', css: 'linear-gradient(160deg, #4b6cff, #7db4ff)' },
  { id: 'magenta', css: 'linear-gradient(160deg, #b13ad6, #ff5f7e)' },
  { id: 'noche', css: 'linear-gradient(160deg, #0b1030, #24489d)' },
  { id: 'atardecer', css: 'linear-gradient(160deg, #ff8a3c, #d52a48)' },
  { id: 'bosque', css: 'linear-gradient(160deg, #0e7a5f, #7bd88f)' },
  { id: 'grafito', css: 'linear-gradient(160deg, #1d2633, #4a5568)' },
  { id: 'oro', css: 'linear-gradient(160deg, #f2b705, #ff7a3c)' },
  { id: 'menta', css: 'linear-gradient(160deg, #12b5a5, #7de3ff)' },
]

export const TEXT_FONTS = [
  { id: 'clasica', name: 'Clásica', stack: '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif', weight: 700 },
  { id: 'fuerte', name: 'Fuerte', stack: '"Arial Black", "Segoe UI", system-ui, sans-serif', weight: 900 },
  { id: 'maquina', name: 'Máquina', stack: '"Courier New", ui-monospace, Menlo, monospace', weight: 700 },
  { id: 'elegante', name: 'Elegante', stack: 'Georgia, "Times New Roman", serif', weight: 600 },
]

export const TEXT_COLORS = [
  '#ffffff', '#000000', '#f2b705', '#d52a48', '#24489d', '#12b5a5', '#ff5f7e', '#7db4ff',
]

export function getFilterById(id) {
  return PHOTO_FILTERS.find((item) => item.id === id) || PHOTO_FILTERS[0]
}

export function getFontById(id) {
  return TEXT_FONTS.find((item) => item.id === id) || TEXT_FONTS[0]
}

export function getBackgroundById(id) {
  return TEXT_BACKGROUNDS.find((item) => item.id === id) || TEXT_BACKGROUNDS[0]
}

export function clamp(value, min, max, fallback = min) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function defaultAdjustments() {
  return { brightness: 1, contrast: 1, saturation: 1, warmth: 0, vignette: 0, blur: 0 }
}

/** Construye el string de filtro (preset + ajustes manuales) para DOM o canvas. */
export function buildFilterCss(filterId, adjust = defaultAdjustments()) {
  const preset = getFilterById(filterId).css
  const parts = []
  if (preset) parts.push(preset)
  if (adjust.brightness !== 1) parts.push(`brightness(${adjust.brightness})`)
  if (adjust.contrast !== 1) parts.push(`contrast(${adjust.contrast})`)
  if (adjust.saturation !== 1) parts.push(`saturate(${adjust.saturation})`)
  if (adjust.warmth > 0) parts.push(`sepia(${adjust.warmth}) hue-rotate(-10deg)`)
  if (adjust.warmth < 0) parts.push(`hue-rotate(${adjust.warmth * 40}deg) saturate(1.05)`)
  if (adjust.blur > 0) parts.push(`blur(${adjust.blur}px)`)
  return parts.join(' ').trim() || 'none'
}

export function createTextLayer(overrides = {}) {
  return {
    id: `t_${Date.now()}_${Math.floor(Math.random() * 1e5)}`,
    text: 'Toca para editar',
    xPct: 50,
    yPct: 46,
    color: '#ffffff',
    fontId: 'clasica',
    sizePct: 8,
    align: 'center',
    background: false,
    ...overrides,
  }
}

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      resolve({ image, url })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo leer la imagen.'))
    }
    image.src = url
  })
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

function drawTextLayers(ctx, layers, width, height) {
  for (const layer of layers) {
    const text = String(layer.text || '').trim()
    if (!text) continue

    const font = getFontById(layer.fontId)
    const fontSize = Math.round((clamp(layer.sizePct, 3, 22, 8) / 100) * width)
    const lineHeight = Math.round(fontSize * 1.25)
    ctx.font = `${font.weight} ${fontSize}px ${font.stack}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = layer.align

    // Ajuste de línea por palabras al 84% del ancho del lienzo.
    const maxLineWidth = width * 0.84
    const lines = []
    for (const rawLine of text.split('\n')) {
      const words = rawLine.split(/\s+/).filter(Boolean)
      if (!words.length) {
        lines.push('')
        continue
      }
      let current = words[0]
      for (let i = 1; i < words.length; i += 1) {
        const candidate = `${current} ${words[i]}`
        if (ctx.measureText(candidate).width > maxLineWidth) {
          lines.push(current)
          current = words[i]
        } else {
          current = candidate
        }
      }
      lines.push(current)
    }

    const cx = (clamp(layer.xPct, 0, 100, 50) / 100) * width
    const cy = (clamp(layer.yPct, 0, 100, 50) / 100) * height
    const totalHeight = lines.length * lineHeight
    let y = cy - totalHeight / 2 + lineHeight / 2

    if (layer.background) {
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width))
      const padX = fontSize * 0.4
      const padY = fontSize * 0.24
      ctx.fillStyle = layer.color === '#000000' ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.42)'
      roundRect(
        ctx,
        cx - widest / 2 - padX,
        y - lineHeight / 2 - padY,
        widest + padX * 2,
        totalHeight + padY * 2,
        fontSize * 0.28,
      )
      ctx.fill()
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = fontSize * 0.14
      ctx.shadowOffsetY = fontSize * 0.03
    }

    ctx.fillStyle = layer.color
    for (const line of lines) {
      ctx.fillText(line, cx, y)
      y += lineHeight
    }
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }
}

function drawVignette(ctx, width, height, amount) {
  if (!amount) return
  const gradient = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.32,
    width / 2, height / 2, Math.max(width, height) * 0.72,
  )
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, `rgba(0,0,0,${clamp(amount, 0, 0.85, 0)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)
}

/**
 * Renderiza la historia a un Blob JPEG (9:16).
 * @param {{
 *  image?: HTMLImageElement | null,
 *  backgroundCss?: string,
 *  filterCss?: string,
 *  adjust?: ReturnType<typeof defaultAdjustments>,
 *  zoom?: number,
 *  rotation?: number,
 *  offsetXPct?: number,
 *  offsetYPct?: number,
 *  textLayers?: Array<ReturnType<typeof createTextLayer>>,
 *  clockLabel?: string,
 * }} options
 * @returns {Promise<Blob>}
 */
export async function renderStoryToBlob(options) {
  const {
    image = null,
    backgroundCss = '',
    filterCss = 'none',
    adjust = defaultAdjustments(),
    zoom = 1,
    rotation = 0,
    offsetXPct = 0,
    offsetYPct = 0,
    textLayers = [],
    clockLabel = '',
    width = STORY_RENDER_WIDTH,
    height = STORY_RENDER_HEIGHT,
  } = options
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  // Fondo (degradado o negro).
  if (backgroundCss.startsWith('linear-gradient')) {
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    const stops = backgroundCss.match(/#[0-9a-fA-F]{3,8}/g) || ['#1d2633', '#4a5568']
    stops.forEach((color, index) => {
      gradient.addColorStop(stops.length === 1 ? 0 : index / (stops.length - 1), color)
    })
    ctx.fillStyle = gradient
  } else {
    ctx.fillStyle = '#000000'
  }
  ctx.fillRect(0, 0, width, height)

  // Imagen con encuadre (cover) + zoom + rotación + desplazamiento.
  if (image && image.naturalWidth) {
    ctx.save()
    ctx.filter = filterCss && filterCss !== 'none' ? filterCss : 'none'
    ctx.translate(width / 2 + (offsetXPct / 100) * width, height / 2 + (offsetYPct / 100) * height)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(zoom, zoom)

    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
    const drawWidth = image.naturalWidth * scale
    const drawHeight = image.naturalHeight * scale
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
    ctx.restore()
    ctx.filter = 'none'
  }

  drawVignette(ctx, width, height, adjust.vignette)

  if (clockLabel) {
    ctx.font = `700 ${Math.round(width * 0.09)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = width * 0.02
    ctx.fillText(clockLabel, width * 0.07, height * 0.06)
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
  }

  drawTextLayers(ctx, textLayers, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('No se pudo generar la imagen de la historia.'))
      },
      'image/jpeg',
      0.9,
    )
  })
}

export function blobToFile(blob, name) {
  return new File([blob], name, { type: blob.type || 'image/jpeg' })
}

export function nowClockLabel() {
  return new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
}

/** @typedef {{ label: string, path: string, badge?: string }} TopLink */
/** @typedef {{ icon: string, label: string, count: string, path: string }} NavItem */
/** @typedef {{ icon: string, label: string, href: string }} ActivityLink */
/** @typedef {{ label: string, href: string }} FooterLink */
/** @typedef {{
 * id: string,
 * label: string,
 * live?: boolean,
 * seen?: boolean,
 * mediaUrl?: string,
 * mediaType?: string,
 * reactions?: number,
 * source?: string,
 * externalUrl?: string,
 * createdAt?: string,
 * editor?: {
 *   overlayText?: string,
 *   locationTag?: string,
 *   clockLabel?: string,
 *   textColor?: string,
 *   textSize?: number,
 *   textPositionY?: number,
 *   textAlign?: 'left' | 'center' | 'right',
 *   filter?: 'none' | 'warm' | 'cold' | 'mono' | 'dramatic'
 * },
 * music?: {
 *   trackId?: string,
 *   title?: string,
 *   artist?: string,
 *   previewUrl?: string,
 *   startSeconds?: number,
 *   volume?: number,
 *   durationSec?: number
 * }
 * }} StoryItem */
/** @typedef {{
 * id: string | number,
 * ownerId?: string,
 * author: string,
 * meta: string,
 * tag: string,
 * tagClass: string,
 * media: string,
 * mediaUrl?: string,
 * createdAt?: string,
 * location?: string,
 * caption: string,
 * reactions: number,
 * comments: number,
 * tone: 'warm' | 'cool' | 'new'
 * }} Post */
/** @typedef {{ id: string, title: string, subtitle: string, pulse: 'red' | 'gold' | 'blue' }} FocusItem */
/** @typedef {{ title: string, subtitle: string, pulse: 'red' | 'gold' | 'blue' }} WeeklyTopic */

/** @type {TopLink[]} */
export const topLinks = [
  { label: 'Inicio', path: '/' },
  { label: 'Historias', path: '/historias' },
  { label: 'Acceso', path: '/acceso' },
  { label: 'Noticias', path: '/noticias' },
  { label: 'Explorar', path: '/explorar' },
  { label: 'Denuncias', path: '/denuncias', badge: '6' },
  { label: 'En vivo', path: '/vivo' },
  { label: 'Perfil', path: '/perfil' },
]

/** @type {NavItem[]} */
export const navItems = [
  { icon: '⌂', label: 'Inicio', count: '17', path: '/' },
  { icon: '◉', label: 'Historias', count: '08', path: '/historias' },
  { icon: '☑', label: 'Acceso', count: '01', path: '/acceso' },
  { icon: '✦', label: 'Noticias', count: '11', path: '/noticias' },
  { icon: '◎', label: 'Explorar', count: '09', path: '/explorar' },
  { icon: '⚠', label: 'Denuncias', count: '12', path: '/denuncias' },
  { icon: '▶', label: 'En vivo', count: '05', path: '/vivo' },
  { icon: '☺', label: 'Perfil', count: '03', path: '/perfil' },
]

/** @type {ActivityLink[]} */
export const activityLinks = [
  { icon: '◉', label: 'Tus historias', href: '#stories' },
  { icon: '▱', label: 'Guardado', href: '#saved' },
  { icon: '♧', label: 'Comunidades', href: '#communities' },
]

/** @type {StoryItem[]} */
export const stories = [
  { id: 'colectivos', label: 'Colectivos', live: true },
  { id: 'analisis-ve', label: 'Analisis VE' },
  { id: 'memoria', label: 'Memoria', seen: true },
  { id: 'estado-politico', label: 'Edo. politico' },
  { id: 'mapa-social', label: 'Mapa social', seen: true },
  { id: 'foro-hoy', label: 'Foro hoy' },
]

/** @type {Post[]} */
export const initialPosts = [
  {
    id: 1,
    author: 'Colectivo Vecinal Catia',
    meta: 'hace 5 min · Caracas',
    tag: 'EN VIVO',
    tagClass: 'live',
    media: 'Registro ciudadano · Catia',
    caption:
      'Reporte en tiempo real de movimiento en la zona. Se pide precaucion y evitar la avenida principal.',
    reactions: 238,
    comments: 54,
    tone: 'warm',
  },
  {
    id: 2,
    author: 'Memoria Ciudadana',
    meta: 'hace 2 h · Archivo',
    tag: 'HISTORIA',
    tagClass: 'historia',
    media: 'Archivo audiovisual · 2:14',
    caption:
      '"Salimos a la calle porque ya no aguantabamos mas". Un archivo de voces desde 2017 hasta hoy, para no olvidar.',
    reactions: 612,
    comments: 140,
    tone: 'cool',
  },
]

/** @type {FocusItem[]} */
export const focusItems = [
  {
    id: 'focus-1',
    title: 'Reporte de colectivos en tiempo real',
    subtitle: 'Actualizado hace 5 min',
    pulse: 'red',
  },
  {
    id: 'focus-2',
    title: 'Foro ciudadano hoy en la noche',
    subtitle: '21:00 · Caracas',
    pulse: 'gold',
  },
]

/** @type {WeeklyTopic} */
export const weeklyTopic = {
  title: 'Condiciones de vida y bienestar',
  subtitle: '1,204 publicaciones',
  pulse: 'blue',
}

/** @type {FooterLink[]} */
export const footerLinks = [
  { label: 'Sobre el proyecto', href: '#about' },
  { label: 'Normas de comunidad', href: '#rules' },
  { label: 'Contacto', href: '#contact' },
]

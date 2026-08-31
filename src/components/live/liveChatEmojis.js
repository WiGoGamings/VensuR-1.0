// Paleta de emojis compartida por el chat del directo (visor y monitor del streamer).
export const LIVE_CHAT_EMOJIS = [
  '❤️', '🔥', '👏', '😂', '😍', '😮', '😢', '😡', '🙌', '💪',
  '🇻🇪', '✊', '🕊️', '⭐', '🎉', '👍', '👎', '🤝', '🙏', '💯',
  '😅', '🥺', '😎', '🤔', '👀', '💥', '📣', '⚡', '🌟', '❓',
]

export const LIVE_CHAT_TEXT_MAX = 280

/** Iniciales para el avatar de respaldo en el chat. */
export function chatInitials(name) {
  const text = String(name || '').trim()
  if (!text) return 'VE'
  const parts = text.split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || 'VE'
}

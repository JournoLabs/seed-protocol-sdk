const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** 1024-based size: '0 B', '812 B', '4.2 KB', '38 MB'. One decimal below 10. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const i = Math.min(SIZE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, i)
  const shown = i === 0 ? value : value < 10 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${shown} ${SIZE_UNITS[i]}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Short relative time: 'just now', '5 min ago', '3 h ago', 'yesterday', '12 days ago', or a date. */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} min ago`
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`
  const days = Math.round(diff / DAY)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(timestamp).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Shorten long names (e.g. 43-char Arweave transaction IDs) from the middle, keeping the extension visible. */
export function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}

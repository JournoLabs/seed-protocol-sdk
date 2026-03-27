/**
 * Parse List property values persisted as strings (JSON array or legacy comma-separated ids).
 */
export function parseListPropertyValueFromStorage(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v))
      }
    } catch {
      // fall through to comma split
    }
  }

  return trimmed.split(',').map((s) => s.trim()).filter(Boolean)
}

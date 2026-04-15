import pluralize from 'pluralize'

/** Matches SDK list storage: singular(schemaKey) + PascalCase(ref) + "Ids", e.g. authorIdentityIds → authors */
const CAMEL_LIST_RELATION_IDS = /^(.+?)([A-Z][a-zA-Z]+)Ids$/

/**
 * Maps list-relation storage / wire names to schema-facing plural keys (e.g. `authorIdentityIds` → `authors`).
 * Non-matching keys are returned unchanged.
 */
export function publicListRelationPropertyKey(propertyKey: string): string {
  const camel = CAMEL_LIST_RELATION_IDS.exec(propertyKey)
  if (camel) {
    const singularPart = camel[1]
    if (singularPart) return pluralize(singularPart)
  }
  if (propertyKey.endsWith('_ids')) {
    const base = propertyKey.slice(0, -4)
    const segments = base.split('_').filter(Boolean)
    if (segments.length >= 2) {
      const singularProperty = segments[0]!
      return singularProperty.endsWith('s') ? singularProperty : pluralize(singularProperty)
    }
    return pluralize(base)
  }
  return propertyKey
}

/**
 * Removes keys that are storage aliases for the same list relation as `publicKey`
 * (e.g. delete `authorIdentityIds` when `authors` is the canonical field).
 */
export function stripListRelationStorageAliasesForPublicKey(
  item: Record<string, unknown>,
  publicKey: string
): void {
  for (const k of Object.keys(item)) {
    if (k === publicKey) continue
    if (publicListRelationPropertyKey(k) === publicKey) {
      delete item[k]
    }
  }
}

/** If value is a JSON array string from legacy feed assembly, parse to string[]. */
export function tryCoerceJsonStringArray(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return value
  const s = value.trim()
  if (!s.startsWith('[')) return value
  try {
    const parsed = JSON.parse(s) as unknown
    if (Array.isArray(parsed)) return parsed
  } catch {
    // keep original
  }
  return value
}

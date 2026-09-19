import type { TargetProperty } from './types'

/**
 * True when the target expects a Seed relation uid (or list of uids)
 * rather than a copied scalar string.
 */
export function isRelationLookupTarget(target: TargetProperty): boolean {
  if (target.dataType === 'Relation') return true
  if (target.dataType === 'List') {
    return target.refValueType === 'Relation' || Boolean(target.ref)
  }
  return false
}

/** Trim and collapse internal whitespace for lookup dictionary keys. */
export function normalizeLookupKey(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/**
 * Shape a looked-up uid value for the target dataType.
 * Relation → single string; List → string[].
 */
export function shapeLookupValue(
  mapped: string | string[],
  target: TargetProperty,
): string | string[] {
  if (target.dataType === 'List') {
    if (Array.isArray(mapped)) {
      return mapped.map((u) => String(u).trim()).filter(Boolean)
    }
    const one = String(mapped).trim()
    return one ? [one] : []
  }
  // Relation (or any non-List lookup target): single uid
  if (Array.isArray(mapped)) {
    return String(mapped[0] ?? '').trim()
  }
  return String(mapped).trim()
}

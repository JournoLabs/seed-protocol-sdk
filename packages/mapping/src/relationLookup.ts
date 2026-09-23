import type {
  FieldMapping,
  LookupEntry,
  MappingLookups,
  SourceNode,
  TargetProperty,
} from './types'

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

/** Normalized sample string for a source node (value, then label). */
export function sampleValueFromSource(source: SourceNode | undefined): string {
  if (!source) return ''
  return normalizeLookupKey(source.value || source.label)
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

/** Entries stored on a lookup edge. Missing `lookup` is an empty assignment. */
export function lookupEntriesFromMapping(
  mapping: FieldMapping | undefined,
): LookupEntry[] {
  return mapping?.lookup?.entries ?? []
}

/**
 * First entry whose normalized `value` matches `rawValue`.
 * Empty / whitespace-only refs are ignored.
 */
export function lookupRefFromEntries(
  entries: LookupEntry[] | undefined,
  rawValue: string,
): string | undefined {
  const key = normalizeLookupKey(rawValue)
  if (!key || !entries?.length) return undefined
  for (const entry of entries) {
    if (normalizeLookupKey(entry.value) !== key) continue
    const ref = String(entry.ref ?? '').trim()
    if (ref) return ref
  }
  return undefined
}

/**
 * @deprecated Document-level table. Prefer `lookupRefFromEntries`.
 */
export function lookupRefFromTable(
  lookups: MappingLookups | undefined,
  propertyName: string,
  rawKey: string,
): string | string[] | undefined {
  if (!lookups) return undefined
  const table = lookups[propertyName]
  if (!table) return undefined
  if (Object.prototype.hasOwnProperty.call(table, rawKey)) {
    return table[rawKey]
  }
  return undefined
}

/**
 * Resolve a lookup ref: edge entries first, then deprecated document table.
 */
export function resolveLookupMapped(
  mapping: FieldMapping,
  rawValue: string,
  lookups?: MappingLookups,
): string | string[] | undefined {
  const key = normalizeLookupKey(rawValue)
  const fromEntries = lookupRefFromEntries(mapping.lookup?.entries, key)
  if (fromEntries !== undefined) return fromEntries
  return lookupRefFromTable(lookups, mapping.propertyName, key)
}

export function withLookupEntries(
  edge: FieldMapping,
  entries: LookupEntry[],
): FieldMapping {
  if (entries.length === 0) {
    if (!edge.lookup) return edge
    const { lookup: _lookup, ...rest } = edge
    return rest
  }
  return { ...edge, lookup: { entries } }
}

/** Drop `lookup` when the edge is no longer a lookup job. */
export function stripLookup(edge: FieldMapping): FieldMapping {
  if (!edge.lookup) return edge
  const { lookup: _lookup, ...rest } = edge
  return rest
}

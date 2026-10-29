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

/**
 * A lookup string as stored and shown: NFC, internal whitespace collapsed, trimmed. Case is kept, so
 * an entry reads the way the feed first printed it. Compare with {@link lookupKey}.
 */
export function normalizeLookupKey(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim()
}

/**
 * The key two lookup strings match on: {@link normalizeLookupKey}, then case-folded, so "mira chen"
 * finds the "Mira Chen" entry. Upper- then lower-casing folds `ß` to `ss` and ligatures to their
 * letters as Unicode case folding does; it differs from full case folding for a few characters
 * (Turkish dotted I, Cherokee). Hosts that match lookup strings themselves use this key.
 */
export function lookupKey(raw: string): string {
  return normalizeLookupKey(raw).toUpperCase().toLowerCase()
}

/** Normalized sample string for a source node: its value only, as apply looks it up. */
export function sampleValueFromSource(source: SourceNode | undefined): string {
  if (!source) return ''
  return normalizeLookupKey(source.value ?? '')
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
 * First entry whose `value` has the same {@link lookupKey} as `rawValue`.
 * Empty / whitespace-only refs are ignored.
 */
export function lookupRefFromEntries(
  entries: LookupEntry[] | undefined,
  rawValue: string,
): string | undefined {
  const key = lookupKey(rawValue)
  if (!key || !entries?.length) return undefined
  for (const entry of entries) {
    if (lookupKey(entry.value) !== key) continue
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

/**
 * Every distinct value `mapping`'s source holds across `items` (each item's sources), in first-seen
 * order and spelling, one per {@link lookupKey}; empty values are left out. A lookup is a table
 * across the feed, and the sample alone shows one row of it.
 */
export function collectLookupValues(items: SourceNode[][], mapping: FieldMapping): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  if (!mapping.sourceId) return values
  for (const sources of items) {
    const value = normalizeLookupKey(sources.find((s) => s.id === mapping.sourceId)?.value ?? '')
    const key = lookupKey(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }
  return values
}

/** Drop `lookup` when the edge is no longer a lookup job. */
export function stripLookup(edge: FieldMapping): FieldMapping {
  if (!edge.lookup) return edge
  const { lookup: _lookup, ...rest } = edge
  return rest
}

import type {
  FieldMapping,
  LookupEntry,
  LookupSeparator,
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

/** Separators a host offers when it turns `split` on. Comma is left out: feeds print "Chen, Mira". */
export const DEFAULT_LOOKUP_SEPARATORS: readonly LookupSeparator[] = ['and', '&']

/** An entry's refs, trimmed, empty ones dropped. A stored `{ value, ref }` reads as `[ref]`. */
function entryRefs(entry: LookupEntry): string[] {
  const legacy = (entry as { ref?: unknown }).ref
  const raw = Array.isArray(entry.refs) ? entry.refs : legacy != null ? [legacy] : []
  return raw.map((r) => String(r ?? '').trim()).filter(Boolean)
}

/**
 * Entries stored on a lookup edge, each in the `{ value, refs }` shape: a stored `{ value, ref }`
 * reads as `refs: [ref]`. Missing `lookup` is an empty assignment.
 */
export function lookupEntriesFromMapping(
  mapping: FieldMapping | undefined,
): LookupEntry[] {
  return (mapping?.lookup?.entries ?? []).map((entry) => ({ value: entry.value, refs: entryRefs(entry) }))
}

/**
 * The refs of the first entry whose `value` has the same {@link lookupKey} as `rawValue` and names
 * at least one ref, in the entry's order. Reads a stored `{ value, ref }` as `[ref]`.
 */
export function lookupRefsFromEntries(
  entries: LookupEntry[] | undefined,
  rawValue: string,
): string[] | undefined {
  const key = lookupKey(rawValue)
  if (!key || !entries?.length) return undefined
  for (const entry of entries) {
    if (lookupKey(entry.value) !== key) continue
    const refs = entryRefs(entry)
    if (refs.length > 0) return refs
  }
  return undefined
}

/**
 * @deprecated Document-level table. Prefer `lookupRefsFromEntries`.
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

const SEPARATOR_PATTERNS: Record<LookupSeparator, string> = {
  and: '\\s+and\\s+',
  '&': '\\s*&\\s*',
  ',': '\\s*,\\s*',
}

/**
 * The parts of `rawValue` between `separators`, normalized, empty parts dropped. A value with no
 * separator is one part. ` and ` matches in any case and only with spaces around it, so "Anderson"
 * stays whole.
 */
export function splitLookupValue(rawValue: string, separators: readonly LookupSeparator[]): string[] {
  const value = normalizeLookupKey(rawValue)
  const patterns = [...new Set(separators)].map((s) => SEPARATOR_PATTERNS[s]).filter(Boolean)
  if (!value || patterns.length === 0) return value ? [value] : []
  return value
    .split(new RegExp(patterns.join('|'), 'i'))
    .map(normalizeLookupKey)
    .filter(Boolean)
}

/** What a lookup edge resolved a value to. */
export type LookupResolution = {
  /** Refs in the order the value names them, without repeats. */
  refs: string[]
  /** Values with no entry: the whole value, or each part that missed when the edge split it. */
  unmatched: string[]
  /** True when the value had no entry of its own and was split into more than one part. */
  split: boolean
}

function refsForWhole(mapping: FieldMapping, value: string, lookups?: MappingLookups): string[] | undefined {
  const fromEntries = lookupRefsFromEntries(mapping.lookup?.entries, value)
  if (fromEntries) return fromEntries
  const fromTable = lookupRefFromTable(lookups, mapping.propertyName, value)
  if (fromTable === undefined) return undefined
  const refs = (Array.isArray(fromTable) ? fromTable : [fromTable]).map((r) => String(r).trim()).filter(Boolean)
  return refs.length > 0 ? refs : undefined
}

/**
 * Resolve a lookup value. The whole value's entry wins (edge entries, then the deprecated document
 * table). Without one, an edge with `split` breaks the value into parts and looks each up on its
 * own: the refs of the parts that have entries come back in the value's order, and each part
 * without one is listed in `unmatched`.
 */
export function resolveLookup(
  mapping: FieldMapping,
  rawValue: string,
  lookups?: MappingLookups,
): LookupResolution {
  const value = normalizeLookupKey(rawValue)
  if (!value) return { refs: [], unmatched: [], split: false }
  const whole = refsForWhole(mapping, value, lookups)
  if (whole) return { refs: [...new Set(whole)], unmatched: [], split: false }
  const parts = mapping.split ? splitLookupValue(value, mapping.split.separators) : [value]
  if (parts.length < 2) return { refs: [], unmatched: [value], split: false }
  const refs: string[] = []
  const unmatched: string[] = []
  for (const part of parts) {
    const partRefs = refsForWhole(mapping, part, lookups)
    if (partRefs) refs.push(...partRefs)
    else unmatched.push(part)
  }
  return { refs: [...new Set(refs)], unmatched, split: true }
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

/** Drop `lookup` and `split` when the edge is no longer a lookup job. */
export function stripLookup(edge: FieldMapping): FieldMapping {
  if (!edge.lookup && !edge.split) return edge
  const { lookup: _lookup, split: _split, ...rest } = edge
  return rest
}

/** Set `split` on a lookup edge, or clear it with `null` or an empty list. */
export function withLookupSplit(
  edge: FieldMapping,
  separators: readonly LookupSeparator[] | null,
): FieldMapping {
  if (!separators?.length) {
    if (!edge.split) return edge
    const { split: _split, ...rest } = edge
    return rest
  }
  return { ...edge, split: { separators: [...new Set(separators)] } }
}

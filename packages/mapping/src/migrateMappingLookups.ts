import { lookupEntriesFromMapping, lookupKey, normalizeLookupKey, withLookupEntries } from './relationLookup'
import type { LookupEntry, MappingDocument } from './types'

/** The document lookup table 0.8.0 removed: property name → source value → ref or refs. */
type LegacyLookupTable = Record<string, Record<string, string | string[]>>

/**
 * A document saved before 0.8.0 with its `lookups` table moved onto the lookup edges as
 * `lookup.entries`, and `lookups` dropped. Where an edge already has an entry for a value, the
 * edge's entry stays, as it won at apply. `unused` names the tables with no lookup edge for their
 * property, which nothing can hold; their entries are dropped. Run it once when loading an old
 * document, then save the result.
 */
export function migrateMappingLookups(
  document: MappingDocument & { lookups?: LegacyLookupTable },
): { document: MappingDocument; unused: string[] } {
  const { lookups, ...rest } = document
  if (!lookups) return { document: rest, unused: [] }
  const moved = new Set<string>()
  const mappings = rest.mappings.map((mapping) => {
    const table = lookups[mapping.propertyName]
    if (mapping.resolve !== 'lookup' || !table) return mapping
    moved.add(mapping.propertyName)
    const entries = lookupEntriesFromMapping(mapping)
    const known = new Set(entries.map((entry) => lookupKey(entry.value)))
    const added: LookupEntry[] = []
    for (const [value, refValue] of Object.entries(table)) {
      const key = lookupKey(value)
      const refs = (Array.isArray(refValue) ? refValue : [refValue]).map((r) => String(r).trim()).filter(Boolean)
      if (!key || known.has(key) || refs.length === 0) continue
      known.add(key)
      added.push({ value: normalizeLookupKey(value), refs })
    }
    return added.length > 0 ? withLookupEntries(mapping, [...entries, ...added]) : mapping
  })
  return { document: { ...rest, mappings }, unused: Object.keys(lookups).filter((name) => !moved.has(name)) }
}

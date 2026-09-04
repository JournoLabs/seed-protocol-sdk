import { parseEasPropertyMetadata } from './parseEasPropertyMetadata.js'
import { parseEasRelationPropertyName } from './parseEasRelationPropertyName.js'
import type {
  AttestationLike,
  ChangelogEntry,
  ChangelogOptions,
  PropertyChangelogEntry,
  VersionChangelogEntry,
} from './types.js'

const toCamelCase = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/**
 * Stable-ish deep equality for changelog value comparison.
 */
export function changelogValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === undefined || b === undefined) return false
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export type DecodedProperty = {
  propertyName: string
  value: string | string[]
  camelName?: string
}

/**
 * Decode a single property attestation into name + value (no relation expand).
 * Returns null when metadata cannot be parsed.
 */
export function decodePropertyAttestation(
  property: AttestationLike,
): DecodedProperty | null {
  const parsed = parseEasPropertyMetadata(property.decodedDataJson)
  if (!parsed.ok) return null

  const metadata = parsed.metadata
  let propertyNameSnake = metadata.name
  if (!propertyNameSnake) return null

  const easType = metadata.type
  const isBytes32Relation =
    (easType === 'bytes32' || easType === 'bytes32[]') &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'
  const isNamingConventionRelation =
    !isBytes32Relation &&
    (propertyNameSnake.endsWith('_id') || propertyNameSnake.endsWith('_ids')) &&
    propertyNameSnake !== 'storage_transaction_id' &&
    propertyNameSnake !== 'storage_provider_transaction_id'

  let isRelation = false
  let isList = false
  if (isBytes32Relation || isNamingConventionRelation) {
    isRelation = true
    if (Array.isArray(metadata.value)) {
      isList = true
      if (isNamingConventionRelation) {
        const result = parseEasRelationPropertyName(propertyNameSnake)
        if (result?.isList) {
          propertyNameSnake = result.propertyName
        }
      }
    }
  }

  let propertyValue: string | string[] = metadata.value as string | string[]
  if (isRelation && isList && Array.isArray(propertyValue)) {
    propertyValue = propertyValue.map((v) => String(v))
  } else if (typeof propertyValue !== 'string') {
    propertyValue = JSON.stringify(propertyValue)
  }

  const camelName = toCamelCase(propertyNameSnake)
  return {
    propertyName: propertyNameSnake,
    value: propertyValue,
    camelName: camelName !== propertyNameSnake ? camelName : undefined,
  }
}

/**
 * Build a flat property map from canonical property attestations for one Version.
 */
export function buildFlatSnapshotFromProperties(
  properties: AttestationLike[],
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  for (const property of properties) {
    const decoded = decodePropertyAttestation(property)
    if (!decoded) continue
    snapshot[decoded.propertyName] = decoded.value
    if (decoded.camelName) {
      snapshot[decoded.camelName] = decoded.value
    }
  }
  return snapshot
}

export type VersionSnapshot = {
  versionUid: string
  at: number
  data: Record<string, unknown>
}

/**
 * Diff consecutive version snapshots (ascending by `at`).
 * First version: `before = {}`, all keys in `after` are changed.
 */
export function diffVersionSnapshots(
  sortedSnapshots: VersionSnapshot[],
): VersionChangelogEntry[] {
  const entries: VersionChangelogEntry[] = []
  let before: Record<string, unknown> = {}

  for (const snap of sortedSnapshots) {
    const after = snap.data
    const keySet = new Set([...Object.keys(before), ...Object.keys(after)])
    const changedKeys: string[] = []
    for (const key of keySet) {
      if (!changelogValuesEqual(before[key], after[key])) {
        changedKeys.push(key)
      }
    }
    changedKeys.sort()
    entries.push({
      type: 'version',
      at: snap.at,
      versionUid: snap.versionUid,
      before: { ...before },
      after: { ...after },
      changedKeys,
    })
    before = after
  }

  return entries
}

/**
 * Per-attestation property diffs across all versions (ordered by timeCreated asc).
 */
export function diffPropertyAttestations(
  properties: AttestationLike[],
): PropertyChangelogEntry[] {
  const sorted = [...properties].sort((a, b) => {
    if (a.timeCreated !== b.timeCreated) return a.timeCreated - b.timeCreated
    return a.id.localeCompare(b.id)
  })

  const previousByProperty = new Map<string, unknown>()
  const entries: PropertyChangelogEntry[] = []

  for (const property of sorted) {
    const decoded = decodePropertyAttestation(property)
    if (!decoded) continue

    const names = [decoded.propertyName]
    if (decoded.camelName) names.push(decoded.camelName)

    // Emit one entry per logical property (snake); camel is alias only.
    const previousValue = previousByProperty.has(decoded.propertyName)
      ? previousByProperty.get(decoded.propertyName)
      : undefined
    const nextValue = decoded.value

    if (!changelogValuesEqual(previousValue, nextValue)) {
      entries.push({
        type: 'property',
        at: property.timeCreated,
        versionUid: property.refUID,
        property: decoded.propertyName,
        attestationUid: property.id,
        previousValue,
        nextValue,
      })
    }

    previousByProperty.set(decoded.propertyName, nextValue)
    if (decoded.camelName) {
      previousByProperty.set(decoded.camelName, nextValue)
    }
  }

  return entries
}

/**
 * Filter by `since` (inclusive), then keep the newest `limit` entries (newest-first).
 * Returned array is newest-first when limit is applied; otherwise chronological (asc).
 */
export function applyChangelogFilters(
  entries: ChangelogEntry[],
  options?: ChangelogOptions,
): ChangelogEntry[] {
  let filtered = entries
  if (typeof options?.since === 'number') {
    const since = options.since
    filtered = filtered.filter((e) => e.at >= since)
  }

  if (typeof options?.limit === 'number' && options.limit >= 0) {
    // Newest-first slice, then reverse back to chronological for callers.
    const newestFirst = [...filtered].sort((a, b) => {
      if (b.at !== a.at) return b.at - a.at
      return 0
    })
    filtered = newestFirst.slice(0, options.limit).reverse()
  }

  return filtered
}

import { normalizeDataType } from './property/index'

/** Internal property names that never use Id-suffix metadata convention */
const ID_SUFFIX_EXCLUDE = new Set(['storageTransactionId', 'transactionId'])

/** Data types that store metadata with Id suffix in DB */
const METADATA_ID_SUFFIX_TYPES = ['Image', 'File', 'Html', 'Relation']

/**
 * Whether this type uses Id suffix in metadata table.
 */
export function needsMetadataIdSuffix(
  dataType?: string,
  refValueType?: string
): boolean {
  const dt = normalizeDataType(dataType)
  const rvt = normalizeDataType(refValueType)
  return (
    METADATA_ID_SUFFIX_TYPES.includes(dt) ||
    METADATA_ID_SUFFIX_TYPES.includes(rvt)
  )
}

/**
 * Canonical metadata property name for WRITES.
 * Use when creating/updating metadata.
 */
export function toMetadataPropertyName(
  propertyName: string,
  dataType?: string,
  refValueType?: string
): string {
  if (ID_SUFFIX_EXCLUDE.has(propertyName)) return propertyName
  if (propertyName.endsWith('Ids')) return propertyName
  if (propertyName.endsWith('Id')) return propertyName
  if (needsMetadataIdSuffix(dataType, refValueType)) {
    return `${propertyName}Id`
  }
  return propertyName
}

/**
 * For READS: property names to include in OR query (both variants).
 * When dataType is undefined, includes all variants for safety (backwards compat with getPropertyData).
 */
export function getMetadataPropertyNamesForQuery(
  propertyName: string,
  dataType?: string,
  refValueType?: string
): string[] {
  if (ID_SUFFIX_EXCLUDE.has(propertyName)) return [propertyName]
  if (propertyName.endsWith('Ids')) return [propertyName]
  if (propertyName.endsWith('Id')) {
    const base = propertyName.slice(0, -2)
    return [propertyName, base]
  }
  const needsId =
    needsMetadataIdSuffix(dataType, refValueType) ||
    (dataType === undefined && refValueType === undefined)
  if (needsId) {
    return [propertyName, `${propertyName}Id`, `${propertyName}Ids`]
  }
  return [propertyName]
}

/**
 * Schema property name from metadata name (strip Id/Ids suffix).
 */
export function toSchemaPropertyName(propertyName: string): string | undefined {
  if (propertyName.endsWith('Ids')) return propertyName.slice(0, -3)
  if (propertyName.endsWith('Id')) return propertyName.slice(0, -2)
  return undefined
}

/**
 * Alternate property name for instance lookup (base <-> Id variant).
 */
export function getAlternatePropertyNameForInstanceLookup(
  propertyName: string
): string | undefined {
  if (ID_SUFFIX_EXCLUDE.has(propertyName)) return undefined
  if (propertyName.endsWith('Id')) return propertyName.slice(0, -2)
  return `${propertyName}Id`
}

/** Minimal shape for resolveMetadataRecord; MetadataType from DB has propertyName as string | null */
type RecordWithRef = {
  propertyName: string | null
  refResolvedValue?: string | null
  refSeedType?: string
}

/**
 * Resolve the best metadata record when multiple variants exist (base + Id).
 * For Image/File/Html: prefer the record with refResolvedValue (Id variant has filename).
 */
export function resolveMetadataRecord<T extends RecordWithRef>(
  records: T[],
  preferredPropertyName: string,
  dataType?: string,
  refValueType?: string
): T {
  if (records.length === 0) throw new Error('No records to resolve')
  if (records.length === 1) return records[0]

  const needsId =
    needsMetadataIdSuffix(dataType, refValueType) ||
    (dataType === undefined && refValueType === undefined)

  // For Image/File/Html: prefer the record with refResolvedValue (Id variant has filename)
  if (needsId) {
    const withRef = records.find((r) => r.refResolvedValue)
    if (withRef) return withRef
  }

  // Also prefer by refSeedType when we need file ref
  if (needsId) {
    const byRefSeed = records.find(
      (r) =>
        r.refSeedType === 'image' ||
        r.refSeedType === 'file' ||
        r.refSeedType === 'html'
    )
    if (byRefSeed) return byRefSeed
  }

  // Fallback: prefer exact propertyName match, else first
  return (
    records.find((r) => r.propertyName === preferredPropertyName) ?? records[0]
  )
}

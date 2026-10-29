import pluralize from 'pluralize'
import { easName } from '@seedprotocol/eas'
import { normalizeDataType } from './property/index'
import { INTERNAL_DATA_TYPES, PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP } from './constants'

/**
 * Words ethers' ABI parser reserves (ethers 6 `abi/fragments.js`). EAS parses schema strings with
 * it, so a model or property whose EAS name is one of these can't be registered or encoded.
 */
const ABI_KEYWORDS = new Set(
  (
    'constructor error event fallback function receive struct calldata memory storage payable indexed ' +
    'tuple returns constant external internal private public pure view override'
  ).split(' '),
)

/** Why a model or property can't publish under `name` (its EAS form), or undefined when it can. */
export function abiKeywordProblem(kind: 'Model' | 'Property', name: string, easForm: string): string | undefined {
  if (!ABI_KEYWORDS.has(easForm)) return undefined
  return `${kind} "${name}" publishes as "${easForm}", which EAS schemas can't use (a reserved Solidity ABI word). Rename it.`
}

/** Throws {@link abiKeywordProblem} for a model name. */
export function assertModelNameCanPublish(modelName: string): void {
  const problem = abiKeywordProblem('Model', modelName, easName(modelName))
  if (problem) throw new Error(problem)
}

/** Throws {@link abiKeywordProblem} for a property, named as {@link easPropertyNameForPublish} names it. */
export function assertPropertyNameCanPublish(
  propertyName: string,
  propertyDef?: (PropertySchemaEntry & { name?: string; refValueType?: string | null }) | null,
): void {
  // A List of relations always publishes with its `<Model>Ids` suffix, ref model known or not.
  if (normalizeDataType(propertyDef?.dataType) === 'List' && normalizeDataType(propertyDef?.refValueType ?? undefined) === 'Relation') return
  const easForm = easPropertyNameForPublish(propertyName, { ...propertyDef, refValueType: propertyDef?.refValueType ?? undefined })
  const problem = abiKeywordProblem('Property', propertyName, easForm)
  if (problem) throw new Error(problem)
}

/** Minimal property def shape for List-of-relation storage name resolution */
export type PropertySchemaEntry = {
  dataType?: string
  ref?: string
  refModelName?: string
}

/** Ref model name when propDef is a List of Relation, else undefined. */
export function listRelationRef(propDef: PropertySchemaEntry | undefined): string | undefined {
  if (!propDef) return undefined
  if (normalizeDataType(propDef.dataType) !== 'List') return undefined
  return propDef.ref || propDef.refModelName || undefined
}

/**
 * Storage/EAS name for a List-of-relation property (`authorIdentityIds`), given either its
 * schema key (`authors`) or its storage name. A name already in storage form is returned as-is,
 * so this is safe on ItemProperties built before their schema was known.
 * Returns undefined when propDef is not a List of Relation.
 */
export function listRelationEasPropertyName(
  propertyName: string,
  propDef: PropertySchemaEntry | undefined,
): string | undefined {
  const ref = listRelationRef(propDef)
  if (!ref || !propertyName) return undefined
  if (propertyName.endsWith(`${ref}Ids`)) return propertyName
  return `${pluralize(propertyName, 1)}${ref}Ids`
}

/** refSeedType values of rows whose value names a storage or related seed. */
const REF_SEED_TYPES = new Set(['file', 'image', 'relation', 'html'])

/**
 * The key an item exposes a metadata row's property under. `propertyKey` (the properties row's
 * name, through property_id) when the row has one. Otherwise from the stored name: the key it is a
 * stored form of among `defs`, else the name without a trailing `Id`/`Ids` when `defs` has that
 * key or the row is a ref (refSeedType), else the stored name.
 */
export function metadataRowPropertyKey(
  row: { propertyKey?: string | null; propertyName?: string | null; refSeedType?: string | null },
  defs: Record<string, MetadataPropertyDef | undefined> = {},
): string | undefined {
  if (row.propertyKey) return row.propertyKey
  const name = row.propertyName
  if (!name) return undefined
  const key = propertyKeyFromStoredName(defs, name)
  if (key) return key
  const base = name.endsWith('Ids')
    ? name.slice(0, -3)
    : name.endsWith('Id') && !ID_SUFFIX_EXCLUDE.has(name)
      ? name.slice(0, -2)
      : undefined
  if (base && (Object.prototype.hasOwnProperty.call(defs, base) || REF_SEED_TYPES.has(row.refSeedType ?? ''))) {
    return base
  }
  return name
}

/** Internal property names that never use Id-suffix metadata convention */
const ID_SUFFIX_EXCLUDE = PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP

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

/** Minimal property def shape for the storage-name codec. */
export type MetadataPropertyDef = PropertySchemaEntry & { refValueType?: string }

/**
 * The name new metadata rows of a property are written under (decision D4): a List of Relation's
 * `<singular key><Ref>Ids` (`authors` → `authorIdentityIds`), a single Image, File, Html or
 * Relation's `<key>Id`, anything else its key. Readers match rows by `property_id`; this name only
 * matters for rows that have none.
 */
export function metadataStorageName(key: string, def: MetadataPropertyDef | undefined): string {
  const listName = listRelationEasPropertyName(key, def)
  if (listName) return listName
  if (normalizeDataType(def?.dataType) === 'List') return key
  return toMetadataPropertyName(key, def?.dataType, def?.refValueType)
}

/**
 * Every name a row of this property may be stored under: its storage name, its key, and for an
 * Image, File, Html or Relation (single or List) `<key>Id`, which older writers and sync used.
 */
export function metadataStoredNameForms(key: string, def: MetadataPropertyDef | undefined): string[] {
  const forms = [metadataStorageName(key, def), key]
  if (!ID_SUFFIX_EXCLUDE.has(key) && needsMetadataIdSuffix(def?.dataType, def?.refValueType)) forms.push(`${key}Id`)
  return [...new Set(forms)]
}

/**
 * The schema key a stored metadata name belongs to among `defs` (keyed by schema key): an exact key
 * first, then any of a key's stored forms. Undefined when no property matches. For rows without
 * `property_id`; rows with one take the key from their properties row.
 */
export function propertyKeyFromStoredName(
  defs: Record<string, MetadataPropertyDef | undefined>,
  storedName: string,
): string | undefined {
  if (!storedName) return undefined
  if (Object.prototype.hasOwnProperty.call(defs, storedName)) return storedName
  for (const [key, def] of Object.entries(defs)) {
    if (metadataStoredNameForms(key, def).includes(storedName)) return key
  }
  return undefined
}

/**
 * The names a property's rows may be stored under, for matching rows that have no property_id and
 * outbox ops (which name a property, not its id): the name with and without its `Id` for an Image,
 * File, Html or Relation, or when `dataType` is unknown.
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
    return [propertyName, `${propertyName}Id`]
  }
  return [propertyName]
}

/**
 * The name an item exposes a property under, from the name it is stored under: its alias when it
 * has one (List of relation), else `tagIds` → `tags`, `authorId` → `author`. Names in
 * PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP keep their `Id`.
 */
export function toItemPropertyKey(storedName: string, alias?: string): string {
  if (alias) return alias
  if (storedName.endsWith('Ids')) return pluralize(storedName.slice(0, -3))
  if (storedName.endsWith('Id') && !PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP.has(storedName)) {
    return storedName.slice(0, -2)
  }
  return storedName
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

/**
 * The EAS property name publish writes for an item property (ADR 0008 §3), already in EAS form:
 *
 * - List of relations: its `<name><Model>Ids` storage name (`author_identity_ids`).
 * - Single Relation, Image, File or Html: its schema key (`author`), never the local `<name>Id`
 *   storage name. The key is `propertyDef.name` when known, else `propertyName` without its `Id`.
 * - Anything else: the property name.
 */
export function easPropertyNameForPublish(
  propertyName: string,
  propertyDef?: (PropertySchemaEntry & { name?: string; refValueType?: string }) | null,
): string {
  const listRelationName = listRelationEasPropertyName(propertyName, propertyDef ?? undefined)
  if (listRelationName) return easName(listRelationName)
  if (
    propertyDef &&
    normalizeDataType(propertyDef.dataType) !== 'List' &&
    needsMetadataIdSuffix(propertyDef.dataType, propertyDef.refValueType) &&
    !ID_SUFFIX_EXCLUDE.has(propertyName)
  ) {
    const key = propertyDef.name ?? (propertyName.endsWith('Id') ? propertyName.slice(0, -2) : propertyName)
    return easName(key)
  }
  return easName(propertyName)
}

/**
 * The EAS schema definition publish attests a property under (`string title`, `bytes32 author`),
 * or undefined when its data type has no EAS type. Look schemas up by this, not by name: a name
 * can have schemas of several types (Optimism Sepolia has `bytes32 storage_transaction_id` beside
 * `string storage_transaction_id`).
 */
export function easSchemaDefinitionForProperty(
  propertyName: string,
  propertyDef?: (PropertySchemaEntry & { name?: string; refValueType?: string }) | null,
): string | undefined {
  if (!propertyDef?.dataType) return undefined
  const dataType = normalizeDataType(String(propertyDef.dataType))
  const easType = INTERNAL_DATA_TYPES[dataType as keyof typeof INTERNAL_DATA_TYPES]?.eas
  if (!easType) return undefined
  return `${easType} ${easPropertyNameForPublish(propertyName, propertyDef)}`
}

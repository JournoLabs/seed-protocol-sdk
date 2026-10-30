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
 * Whether a property attestation is a relation (its value a related seed's UID). The SDK writes
 * Relation and List properties as `bytes32` / `bytes32[]`, so the type decides; a `string external_id`
 * is not a relation. The `_id` / `_ids` name suffix decides only when the attestation has no type.
 */
export function isRelationProperty(easPropertyName: string, easType: string | undefined): boolean {
  if (easPropertyName === 'storage_transaction_id' || easPropertyName === 'storage_provider_transaction_id') {
    return false
  }
  if (easType) return easType === 'bytes32' || easType === 'bytes32[]'
  return easPropertyName.endsWith('_id') || easPropertyName.endsWith('_ids')
}

/**
 * The key a relation property is returned under, from its EAS name, in every `relations` mode: a
 * list's schema key (`author_identity_ids` → `authors`), a single relation's name without `_id`
 * (`author_id` → `author`). A list's EAS name is `singular(key) + Model + Ids`, which doesn't keep
 * whether the key was plural (`featured` and `featureds` give the same name); this returns the plural.
 */
export function relationPropertyKey(easPropertyName: string, isList: boolean): string {
  if (isList) return publicListRelationPropertyKey(easPropertyName)
  return easPropertyName.endsWith('_id') ? easPropertyName.slice(0, -3) : easPropertyName
}

/**
 * Removes keys that are storage aliases for the same list relation as `publicKey`
 * (e.g. delete `authorIdentityIds` when `authors` is the canonical field).
 */
export function stripListRelationStorageAliasesForPublicKey(
  item: Record<string, unknown>,
  publicKey: string,
): void {
  for (const k of Object.keys(item)) {
    if (k === publicKey) continue
    if (publicListRelationPropertyKey(k) === publicKey) {
      delete item[k]
    }
  }
}

/** If value is a JSON array string from legacy assembly, parse to string[]. */
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

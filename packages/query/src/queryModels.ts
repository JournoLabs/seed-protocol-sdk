import pluralize from 'pluralize'
import { easName } from '@seedprotocol/eas'
import { generateETag } from './cache/etag.js'

type QueryModelProperty = {
  readonly name?: string
  readonly type?: string
  readonly dataType?: string
  readonly ref?: string
  readonly refModelName?: string
  readonly refValueType?: string
  readonly items?: { readonly model?: string }
}

type QueryModel = {
  readonly name?: string
  readonly properties: { readonly [propertyName: string]: QueryModelProperty } | readonly QueryModelProperty[]
}

/**
 * A schema file's `models`, as much of it as query reads: each List property's `ref` (or the older
 * `items.model`). A `SchemaFileFormat['models']` from `@seedprotocol/sdk` can be passed as it is.
 * Some tools write `models` and each model's `properties` as arrays with a `name` on each entry;
 * those are read the same way, and entries with no `name` are skipped.
 */
export type QueryModels = { readonly [modelName: string]: QueryModel } | readonly QueryModel[]

type Registered = {
  /** By the model's EAS name: a List relation's EAS name → its schema key's EAS name. */
  byModel: Map<string, Map<string, string>>
  /** Same, over every model, for EAS names that mean the same key in each model that has them. */
  anyModel: Map<string, string>
  fingerprint: string
}

let registered: Registered | null = null

/** [name, entry] of a keyed object, or of an array's entries that have a `name`. */
function namedEntries<T extends { readonly name?: string }>(entries: { readonly [name: string]: T } | readonly T[]): [string, T][] {
  if (!Array.isArray(entries)) return Object.entries(entries as { readonly [name: string]: T })
  return (entries as readonly T[]).flatMap((entry) => (entry?.name ? [[entry.name, entry] as [string, T]] : []))
}

/**
 * The EAS name the SDK publishes a List relation under: `singular(key) + Ref + Ids`
 * (`coAuthors` of `Identity` → `co_author_identity_ids`), as `listRelationEasPropertyName` in the
 * SDK writes it.
 */
function listRelationEasName(propertyName: string, ref: string): string {
  const storageName = propertyName.endsWith(`${ref}Ids`) ? propertyName : `${pluralize(propertyName, 1)}${ref}Ids`
  return easName(storageName)
}

/**
 * Sets the models query names List relations by, replacing any set before; `null` clears them.
 * A List relation's EAS name keeps the singular key and the related model run together
 * (`co_author_identity_ids`, `featured_portfolio_clip_ids`), so without the schema the key can't be
 * told apart from the model name; with it, the key comes back as the schema has it (`coAuthors`,
 * `featured`). Lists of models not given here keep the parse (`cos`, `featureds`).
 */
export function setQueryModels(models: QueryModels | null): void {
  if (!models) {
    registered = null
    return
  }
  const byModel = new Map<string, Map<string, string>>()
  const keysByEasName = new Map<string, Set<string>>()
  for (const [modelName, model] of namedEntries(models)) {
    const lists = new Map<string, string>()
    for (const [propertyName, property] of namedEntries(model?.properties ?? {})) {
      if ((property.type ?? property.dataType)?.toLowerCase() !== 'list') continue
      const ref = property.ref ?? property.refModelName ?? property.items?.model
      if (!ref) continue
      const listEasName = listRelationEasName(propertyName, ref)
      const key = easName(propertyName)
      lists.set(listEasName, key)
      const keys = keysByEasName.get(listEasName) ?? new Set<string>()
      keys.add(key)
      keysByEasName.set(listEasName, keys)
    }
    if (lists.size > 0) byModel.set(easName(modelName), lists)
  }
  const anyModel = new Map<string, string>()
  for (const [listEasName, keys] of keysByEasName) {
    if (keys.size === 1) anyModel.set(listEasName, [...keys][0]!)
  }
  const entries = [...byModel].map(([model, lists]) => [model, [...lists].sort()] as const).sort()
  registered = byModel.size > 0 ? { byModel, anyModel, fingerprint: generateETag(JSON.stringify(entries)).slice(1, 9) } : null
}

/**
 * The schema key (snake form) of a List relation's EAS name in `modelName` (a seed's schema name),
 * from the models set with {@link setQueryModels}. Without a model, a key every model agrees on.
 */
export function modelListRelationKey(listEasName: string, modelName: string | undefined): string | undefined {
  if (!registered) return undefined
  const model = modelName !== undefined ? registered.byModel.get(easName(modelName)) : undefined
  return model?.get(listEasName) ?? registered.anyModel.get(listEasName)
}

/** Identifies the models set, for cache keys: records assembled under other models differ. Empty when none. */
export function queryModelsFingerprint(): string {
  return registered?.fingerprint ?? ''
}

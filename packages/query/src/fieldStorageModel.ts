/** Related Seed schema names (lowercased) used as primary rich-body sources. */
export const RICH_BODY_STORAGE_SCHEMAS = new Set(['html', 'file', 'json'])

/** @deprecated Alias for {@link RICH_BODY_STORAGE_SCHEMAS} (feed key compatibility). */
export const FEED_RICH_BODY_STORAGE_SCHEMAS = RICH_BODY_STORAGE_SCHEMAS

/** Kept as `_feedFieldStorageModels` for feed/RSS pickers in Phase 1. */
const FIELD_MODELS_KEY = '_feedFieldStorageModels' as const
const LIST_MODELS_KEY = '_feedListElementStorageModels' as const

export type FieldStorageModels = Record<string, string>
export type ListElementStorageModels = Record<string, string[]>

/** @deprecated Use {@link FieldStorageModels} */
export type FeedFieldStorageModels = FieldStorageModels
/** @deprecated Use {@link ListElementStorageModels} */
export type FeedListElementStorageModels = ListElementStorageModels

function normalizeModelName(schemaName: string): string {
  return schemaName.trim().toLowerCase()
}

export function isRichBodyStorageSchema(schemaName: string): boolean {
  return RICH_BODY_STORAGE_SCHEMAS.has(normalizeModelName(schemaName))
}

/** @deprecated Use {@link isRichBodyStorageSchema} */
export const isFeedRichBodyStorageSchema = isRichBodyStorageSchema

/** html < file < json for tie-breaking among rich body fields. */
export function richBodyModelPriority(schemaName: string): number {
  const m = normalizeModelName(schemaName)
  if (m === 'html') return 0
  if (m === 'file') return 1
  if (m === 'json') return 2
  return 99
}

/** @deprecated Use {@link richBodyModelPriority} */
export const feedRichBodyModelPriority = richBodyModelPriority

export function getFieldStorageModels(
  item: Record<string, unknown>,
): FieldStorageModels | undefined {
  const raw = item[FIELD_MODELS_KEY]
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as FieldStorageModels
  }
  return undefined
}

/** @deprecated Use {@link getFieldStorageModels} */
export const getFeedFieldStorageModels = getFieldStorageModels

export function getListElementStorageModels(
  item: Record<string, unknown>,
): ListElementStorageModels | undefined {
  const raw = item[LIST_MODELS_KEY]
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ListElementStorageModels
  }
  return undefined
}

/** @deprecated Use {@link getListElementStorageModels} */
export const getFeedListElementStorageModels = getListElementStorageModels

export function setFieldStorageModel(
  item: Record<string, unknown>,
  fieldKey: string,
  schemaName: string,
): void {
  const normalized = normalizeModelName(schemaName)
  let map = getFieldStorageModels(item)
  if (!map) {
    map = {}
    item[FIELD_MODELS_KEY] = map
  }
  map[fieldKey] = normalized
}

/** @deprecated Use {@link setFieldStorageModel} */
export const setFeedFieldStorageModel = setFieldStorageModel

export function setListElementStorageModels(
  item: Record<string, unknown>,
  outputKey: string,
  models: string[],
): void {
  let map = getListElementStorageModels(item)
  if (!map) {
    map = {}
    item[LIST_MODELS_KEY] = map
  }
  map[outputKey] = models.map(normalizeModelName)
}

/** @deprecated Use {@link setListElementStorageModels} */
export const setFeedListElementStorageModels = setListElementStorageModels

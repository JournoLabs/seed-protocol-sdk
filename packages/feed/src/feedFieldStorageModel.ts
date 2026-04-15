/** Related Seed schema names (lowercased) used as primary RSS/Atom/JSON body sources. */
export const FEED_RICH_BODY_STORAGE_SCHEMAS = new Set(['html', 'file', 'json'])

const FIELD_MODELS_KEY = '_feedFieldStorageModels' as const
const LIST_MODELS_KEY = '_feedListElementStorageModels' as const

export type FeedFieldStorageModels = Record<string, string>
export type FeedListElementStorageModels = Record<string, string[]>

function normalizeModelName(schemaName: string): string {
  return schemaName.trim().toLowerCase()
}

export function isFeedRichBodyStorageSchema(schemaName: string): boolean {
  return FEED_RICH_BODY_STORAGE_SCHEMAS.has(normalizeModelName(schemaName))
}

/** html &lt; file &lt; json for tie-breaking among rich body fields. */
export function feedRichBodyModelPriority(schemaName: string): number {
  const m = normalizeModelName(schemaName)
  if (m === 'html') return 0
  if (m === 'file') return 1
  if (m === 'json') return 2
  return 99
}

export function getFeedFieldStorageModels(
  item: Record<string, unknown>,
): FeedFieldStorageModels | undefined {
  const raw = item[FIELD_MODELS_KEY]
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as FeedFieldStorageModels
  }
  return undefined
}

export function getFeedListElementStorageModels(
  item: Record<string, unknown>,
): FeedListElementStorageModels | undefined {
  const raw = item[LIST_MODELS_KEY]
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as FeedListElementStorageModels
  }
  return undefined
}

export function setFeedFieldStorageModel(
  item: Record<string, unknown>,
  fieldKey: string,
  schemaName: string,
): void {
  const normalized = normalizeModelName(schemaName)
  let map = getFeedFieldStorageModels(item)
  if (!map) {
    map = {}
    item[FIELD_MODELS_KEY] = map
  }
  map[fieldKey] = normalized
}

export function setFeedListElementStorageModels(
  item: Record<string, unknown>,
  outputKey: string,
  models: string[],
): void {
  let map = getFeedListElementStorageModels(item)
  if (!map) {
    map = {}
    item[LIST_MODELS_KEY] = map
  }
  map[outputKey] = models.map(normalizeModelName)
}

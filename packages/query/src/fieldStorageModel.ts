/** Related Seed schema names (lowercased) used as primary rich-body sources. */
export const RICH_BODY_STORAGE_SCHEMAS = new Set(['html', 'file', 'json'])

/** Kept as `_feedFieldStorageModels` for feed/RSS pickers in Phase 1. */
const FIELD_MODELS_KEY = '_feedFieldStorageModels' as const
const LIST_MODELS_KEY = '_feedListElementStorageModels' as const

export type FieldStorageModels = Record<string, string>
export type ListElementStorageModels = Record<string, string[]>

function normalizeModelName(schemaName: string): string {
  return schemaName.trim().toLowerCase()
}

export function isRichBodyStorageSchema(schemaName: string): boolean {
  return RICH_BODY_STORAGE_SCHEMAS.has(normalizeModelName(schemaName))
}

/** html < file < json for tie-breaking among rich body fields. */
export function richBodyModelPriority(schemaName: string): number {
  const m = normalizeModelName(schemaName)
  if (m === 'html') return 0
  if (m === 'file') return 1
  if (m === 'json') return 2
  return 99
}

export function getFieldStorageModels(
  item: Record<string, unknown>,
): FieldStorageModels | undefined {
  const raw = item[FIELD_MODELS_KEY]
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as FieldStorageModels
  }
  return undefined
}

export function getListElementStorageModels(
  item: Record<string, unknown>,
): ListElementStorageModels | undefined {
  const raw = item[LIST_MODELS_KEY]
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ListElementStorageModels
  }
  return undefined
}

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


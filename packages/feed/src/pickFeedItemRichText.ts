/**
 * Resolves RSS/Atom/JSON feed `description` and `content` from dynamic Seed item shapes.
 * Html-type properties often use `body`; `html` / `content` are alternate sources.
 */

import {
  feedRichBodyModelPriority,
  getFeedFieldStorageModels,
  getFeedListElementStorageModels,
  isFeedRichBodyStorageSchema,
} from './feedFieldStorageModel'

function firstNonEmptyString(item: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = item[k]
    if (typeof v === 'string' && v.trim() !== '') {
      return v
    }
  }
  return ''
}

/** Short text fields only (excerpt / summary) — not full HTML body keys. */
export const DESCRIPTION_KEYS = ['summary', 'Summary', 'description', 'Description', 'text', 'Text'] as const

/**
 * Primary HTML / rich body keys first, then plain fallbacks (same as legacy `content` chain).
 */
export const CONTENT_PRIMARY_KEYS = ['html', 'Html', 'body', 'Body', 'content', 'Content'] as const

const CONTENT_FALLBACK_KEYS = ['summary', 'Summary', 'description', 'Description', 'text', 'Text'] as const

type RichBodyCandidate = {
  model: string
  key: string
  index: number
  value: string
}

function compareRichBodyCandidates(a: RichBodyCandidate, b: RichBodyCandidate): number {
  const d = feedRichBodyModelPriority(a.model) - feedRichBodyModelPriority(b.model)
  if (d !== 0) return d
  const k = a.key.localeCompare(b.key)
  if (k !== 0) return k
  return a.index - b.index
}

function pickTypedRichBodyContent(item: Record<string, unknown>): string {
  const fieldModels = getFeedFieldStorageModels(item)
  const listModels = getFeedListElementStorageModels(item)
  let best: RichBodyCandidate | null = null

  if (fieldModels) {
    for (const [key, model] of Object.entries(fieldModels)) {
      if (!isFeedRichBodyStorageSchema(model)) continue
      const v = item[key]
      if (typeof v !== 'string' || v.trim() === '') continue
      const cand: RichBodyCandidate = { model, key, index: 0, value: v }
      if (!best || compareRichBodyCandidates(cand, best) < 0) best = cand
    }
  }

  if (listModels) {
    for (const [listKey, models] of Object.entries(listModels)) {
      const arr = item[listKey]
      if (!Array.isArray(arr)) continue
      const n = Math.min(models.length, arr.length)
      for (let i = 0; i < n; i++) {
        const model = models[i]!
        if (!isFeedRichBodyStorageSchema(model)) continue
        const el = arr[i]
        if (typeof el !== 'string' || el.trim() === '') continue
        const cand: RichBodyCandidate = { model, key: listKey, index: i, value: el }
        if (!best || compareRichBodyCandidates(cand, best) < 0) best = cand
      }
    }
  }

  return best?.value ?? ''
}

export function pickFeedItemDescription(item: Record<string, unknown>): string {
  return firstNonEmptyString(item, DESCRIPTION_KEYS)
}

export function pickFeedItemContent(item: Record<string, unknown>): string {
  const typed = pickTypedRichBodyContent(item)
  if (typed !== '') return typed
  const primary = firstNonEmptyString(item, CONTENT_PRIMARY_KEYS)
  if (primary !== '') return primary
  return firstNonEmptyString(item, CONTENT_FALLBACK_KEYS)
}

function stringFieldContainsDataUriImage(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return value.includes('data:image/') && value.includes(';base64,')
}

function feedItemTypedRichFieldsContainDataUriImage(item: Record<string, unknown>): boolean {
  const fieldModels = getFeedFieldStorageModels(item)
  if (fieldModels) {
    for (const [key, model] of Object.entries(fieldModels)) {
      if (!isFeedRichBodyStorageSchema(model)) continue
      if (stringFieldContainsDataUriImage(item[key])) return true
    }
  }
  const listModels = getFeedListElementStorageModels(item)
  if (listModels) {
    for (const [listKey, models] of Object.entries(listModels)) {
      const arr = item[listKey]
      if (!Array.isArray(arr)) continue
      const n = Math.min(models.length, arr.length)
      for (let i = 0; i < n; i++) {
        if (!isFeedRichBodyStorageSchema(models[i]!)) continue
        if (stringFieldContainsDataUriImage(arr[i])) return true
      }
    }
  }
  return false
}

/**
 * True when primary body keys or excerpt-style keys contain an embedded `data:image/...;base64,...` URI.
 * Used by feed generation to omit oversized RSS entries by default.
 */
export function feedItemRichTextContainsDataUriImage(item: Record<string, unknown>): boolean {
  if (feedItemTypedRichFieldsContainDataUriImage(item)) return true
  for (const k of CONTENT_PRIMARY_KEYS) {
    if (stringFieldContainsDataUriImage(item[k])) return true
  }
  for (const k of DESCRIPTION_KEYS) {
    if (stringFieldContainsDataUriImage(item[k])) return true
  }
  return false
}

export function filterItemsByRichTextDataUriImagePolicy<T extends Record<string, unknown>>(
  items: readonly T[],
  richTextDataUriImages: 'omit_items' | 'include_items' = 'omit_items',
): T[] {
  if (richTextDataUriImages === 'include_items') return [...items]
  return items.filter((item) => !feedItemRichTextContainsDataUriImage(item))
}

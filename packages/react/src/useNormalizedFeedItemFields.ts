import { useMemo } from 'react'
import {
  normalizeFeedItemFields,
  type FeedFieldManifest,
  type NormalizedFeedFieldValue,
} from '@seedprotocol/sdk'

/**
 * Synchronously classify feed item fields from a manifest (no network).
 * Memoized; pass a stable `manifest` reference when possible.
 */
export function useNormalizedFeedItemFields(
  item: Record<string, unknown> | null | undefined,
  manifest: FeedFieldManifest,
): Record<string, NormalizedFeedFieldValue | undefined> {
  return useMemo(() => {
    if (!item) {
      return {}
    }
    return normalizeFeedItemFields(item, manifest)
  }, [item, manifest])
}

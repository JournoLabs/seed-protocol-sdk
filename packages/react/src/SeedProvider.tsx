import React, { type ReactNode, useMemo, useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { createSeedQueryClient } from './queryClient'
import { eventEmitter } from '@seedprotocol/sdk'
import { SeedAddressRevisionProvider } from './SeedSessionContext'

export type SeedProviderProps = {
  children: ReactNode
  /** Optional: use your own QueryClient. If not provided, a default client with Seed options is created. */
  queryClient?: QueryClient
  /** Optional: ref to receive the QueryClient instance (e.g. for tests). */
  queryClientRef?: React.MutableRefObject<QueryClient | null>
}

declare global {
  interface Window {
    __SEED_INVALIDATE_ITEM_PROPERTIES__?: ((canonicalId: string) => void) | null
  }
}

/** Module-level ref so invalidateItemPropertiesForItem works when test and app share the same bundle but not the same window (e.g. iframe). */
let invalidateItemPropertiesRef: ((canonicalId: string) => void | Promise<void>) | null = null

/**
 * Invalidates and refetches the item-properties query for an item.
 * Call this after updating an ItemProperty (e.g. after save()) so useItemProperties
 * refetches and the UI updates. Returns a Promise that resolves when the refetch has completed (if available).
 */
export function invalidateItemPropertiesForItem(canonicalId: string): Promise<void> {
  const p1 = invalidateItemPropertiesRef?.(canonicalId)
  if (typeof window !== 'undefined' && window.__SEED_INVALIDATE_ITEM_PROPERTIES__) {
    window.__SEED_INVALIDATE_ITEM_PROPERTIES__(canonicalId)
  }
  return Promise.resolve(p1).then(() => {})
}

function SeedProviderEventSubscriber({ queryClient }: { queryClient: QueryClient }) {
  useEffect(() => {
    const invalidate = (canonicalId: string) => {
      const key: readonly [string, string, string] = ['seed', 'itemProperties', canonicalId]
      queryClient.invalidateQueries({ queryKey: key })
      return queryClient.refetchQueries({ queryKey: key })
    }
    invalidateItemPropertiesRef = invalidate
    if (typeof window !== 'undefined') {
      window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = invalidate
    }
    const handler = (payload: { seedLocalId?: string; seedUid?: string }) => {
      const canonicalId = payload?.seedLocalId ?? payload?.seedUid
      if (canonicalId) {
        invalidate(canonicalId)
      }
    }
    eventEmitter.on('itemProperty.saved', handler)
    return () => {
      eventEmitter.off('itemProperty.saved', handler)
      invalidateItemPropertiesRef = null
      if (typeof window !== 'undefined') {
        window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = null
      }
    }
  }, [queryClient])
  return null
}

/**
 * Provider that supplies a React Query client to Seed list hooks (useSchemas, useItems, useModels, etc.)
 * so results are cached and shared across components. Wrap your app (or the subtree that uses Seed hooks)
 * after calling client.init().
 *
 * - No props: uses an internal QueryClient with Seed defaults.
 * - queryClient prop: use your own client (e.g. merge getSeedQueryDefaultOptions when creating it).
 */
export function SeedProvider({ children, queryClient: queryClientProp, queryClientRef }: SeedProviderProps) {
  const queryClient = useMemo(
    () => queryClientProp ?? createSeedQueryClient(),
    [queryClientProp]
  )
  if (queryClientRef) {
    queryClientRef.current = queryClient
    if (typeof window !== 'undefined') {
      const w = window as { __TEST_SEED_QUERY_CLIENT__?: QueryClient }
      w.__TEST_SEED_QUERY_CLIENT__ = queryClient
      try {
        if (window.parent && window.parent !== window) (window.parent as { __TEST_SEED_QUERY_CLIENT__?: QueryClient }).__TEST_SEED_QUERY_CLIENT__ = queryClient
      } catch {
        // cross-origin frame, ignore
      }
    }
  }
  return (
    <QueryClientProvider client={queryClient}>
      <SeedAddressRevisionProvider queryClient={queryClient}>
        <SeedProviderEventSubscriber queryClient={queryClient} />
        {children}
      </SeedAddressRevisionProvider>
    </QueryClientProvider>
  )
}

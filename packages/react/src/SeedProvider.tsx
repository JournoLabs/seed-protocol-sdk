import React, { type ReactNode, useMemo, useEffect, useRef } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { createSeedQueryClient } from './queryClient'
import { client, eventEmitter, EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@seedprotocol/sdk'
import type { SeedConfig, SeedConstructorOptions } from '@seedprotocol/sdk'
import { SeedAddressRevisionProvider } from './SeedSessionContext'

export type SeedProviderProps = {
  children: ReactNode
  /**
   * Starts the Seed client with this config (`client.init`) when the provider mounts. Children
   * render straight away; the hooks report loading until the client is ready. Leave it out when you
   * call `client.init` yourself or start the client with `SeedClientGate`. Init runs again when
   * the config object changes, so define it outside the component.
   */
  config?: SeedConfig
  /** Addresses passed to `client.init` with `config`. See `SeedConstructorOptions.addresses`. */
  addresses?: SeedConstructorOptions['addresses']
  /**
   * Called when `client.init` fails, e.g. with `DatabaseNotPersistentError` (`DB_NOT_PERSISTENT`)
   * or `FileSystemLockedError` (`OPFS_LOCKED`). Without it the error is logged.
   */
  onInitError?: (err: unknown) => void
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
    const onEasSyncedToDb = () => {
      void queryClient.invalidateQueries({ queryKey: ['seed', 'items'], exact: false })
    }
    eventEmitter.on('itemProperty.saved', handler)
    eventEmitter.on(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSyncedToDb)
    return () => {
      eventEmitter.off('itemProperty.saved', handler)
      eventEmitter.off(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSyncedToDb)
      invalidateItemPropertiesRef = null
      if (typeof window !== 'undefined') {
        window.__SEED_INVALIDATE_ITEM_PROPERTIES__ = null
      }
    }
  }, [queryClient])
  return null
}

function SeedClientInit({ config, addresses, onInitError }: Pick<SeedProviderProps, 'addresses' | 'onInitError'> & { config: SeedConfig }) {
  // Refs, so inline callbacks and address arrays don't re-run init on every render.
  const onInitErrorRef = useRef(onInitError)
  onInitErrorRef.current = onInitError
  const addressesRef = useRef(addresses)
  addressesRef.current = addresses
  const addressesKey = JSON.stringify(addresses ?? null)

  useEffect(() => {
    const options: SeedConstructorOptions =
      addressesRef.current === undefined ? { config } : { config, addresses: addressesRef.current }
    client.init(options).catch((err: unknown) => {
      if (onInitErrorRef.current) {
        onInitErrorRef.current(err)
      } else {
        console.error('[SeedProvider] client init failed', err)
      }
    })
  }, [config, addressesKey])
  return null
}

/**
 * Provider that supplies a React Query client to Seed list hooks (useSchemas, useItems, useModels, etc.)
 * so results are cached and shared across components. Wrap your app (or the subtree that uses Seed hooks).
 *
 * - config prop: starts the client with `client.init({ config, addresses })`.
 * - No queryClient prop: uses an internal QueryClient with Seed defaults.
 * - queryClient prop: use your own client (e.g. merge getSeedQueryDefaultOptions when creating it).
 */
export function SeedProvider({
  children,
  config,
  addresses,
  onInitError,
  queryClient: queryClientProp,
  queryClientRef,
}: SeedProviderProps) {
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
        {config && <SeedClientInit config={config} addresses={addresses} onInitError={onInitError} />}
        {children}
      </SeedAddressRevisionProvider>
    </QueryClientProvider>
  )
}

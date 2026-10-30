import React, { type ReactNode, useMemo, useEffect, useRef } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { createSeedQueryClient } from './queryClient'
import { client, eventEmitter, EAS_SEED_DATA_SYNCED_TO_DB_EVENT } from '@seedprotocol/sdk'
import type { SeedConfig, SeedConstructorOptions } from '@seedprotocol/sdk'
import { SeedAddressRevisionProvider } from './SeedSessionContext'
import { useAddressesProp } from './useAddressesProp'

export type SeedProviderProps = {
  children: ReactNode
  /**
   * Starts the Seed client with this config (`client.init`) when the provider mounts. Children
   * render straight away; the hooks report loading until the client is ready. Leave it out when you
   * call `client.init` yourself or start the client with `SeedClientGate`. Init runs again when
   * the config object changes, so define it outside the component.
   */
  config?: SeedConfig
  /**
   * Addresses passed to `client.init` with `config`. See `SeedConstructorOptions.addresses`. When
   * the prop later holds different addresses the provider calls `client.setAddresses` with them,
   * so `[]` after a disconnect clears them. Leaving it out keeps the stored ones.
   */
  addresses?: SeedConstructorOptions['addresses']
  /**
   * Called when `client.init` fails, e.g. with `DatabaseNotPersistentError` (`DB_NOT_PERSISTENT`),
   * `FileSystemLockedError` (`OPFS_LOCKED`) or `UnsupportedBrowserError` (`BROWSER_UNSUPPORTED`).
   * Without it the error is logged.
   */
  onInitError?: (err: unknown) => void
  /** Optional: use your own QueryClient. If not provided, a default client with Seed options is created. */
  queryClient?: QueryClient
  /** Optional: ref to receive the QueryClient instance (e.g. for tests). */
  queryClientRef?: React.MutableRefObject<QueryClient | null>
}

/** Module-level ref so invalidateItemPropertiesForItem works when test and app share the same bundle but not the same window (e.g. iframe). */
let invalidateItemPropertiesRef: ((canonicalId: string) => Promise<void>) | null = null

/**
 * Invalidates and refetches the item-properties query for an item, and resolves when the refetch
 * has completed. Saves don't need it: `useItemProperties` refetches when the change feed reports a
 * write to the item's metadata rows (ADR 0020).
 */
export function invalidateItemPropertiesForItem(canonicalId: string): Promise<void> {
  return Promise.resolve(invalidateItemPropertiesRef?.(canonicalId))
}

function SeedProviderEventSubscriber({ queryClient }: { queryClient: QueryClient }) {
  useEffect(() => {
    invalidateItemPropertiesRef = (canonicalId: string) =>
      queryClient.invalidateQueries({ queryKey: ['seed', 'itemProperties', canonicalId] })
    const onEasSyncedToDb = () => {
      void queryClient.invalidateQueries({ queryKey: ['seed', 'items'], exact: false })
    }
    eventEmitter.on(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSyncedToDb)
    return () => {
      eventEmitter.off(EAS_SEED_DATA_SYNCED_TO_DB_EVENT, onEasSyncedToDb)
      invalidateItemPropertiesRef = null
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
  const initRef = useRef<Promise<void> | undefined>(undefined)

  useEffect(() => {
    const options: SeedConstructorOptions =
      addressesRef.current === undefined ? { config } : { config, addresses: addressesRef.current }
    initRef.current = client.init(options)
    initRef.current.catch((err: unknown) => {
      if (onInitErrorRef.current) {
        onInitErrorRef.current(err)
      } else {
        console.error('[SeedProvider] client init failed', err)
      }
    })
  }, [config])
  // A repeat init leaves the stored addresses alone: later changes go through setAddresses
  useAddressesProp(addresses, initRef, 'SeedProvider')
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

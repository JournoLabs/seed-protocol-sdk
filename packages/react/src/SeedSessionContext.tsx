import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { eventEmitter } from '@seedprotocol/sdk'
import { ADDRESSES_PERSISTED_EVENT } from './addressesPersistedEventName'

const SeedAddressRevisionContext = createContext(0)

/**
 * Bumps when persisted wallet/session addresses change (`setAddresses` completed).
 * Used by `useItems` / `useItem` so list and detail hooks refresh after connect/disconnect.
 * Outside {@link SeedAddressRevisionProvider} (e.g. without `SeedProvider`), this stays `0`.
 */
export function useSeedAddressRevision(): number {
  return useContext(SeedAddressRevisionContext)
}

export function SeedAddressRevisionProvider({
  queryClient,
  children,
}: {
  queryClient: QueryClient
  children: ReactNode
}) {
  const [addressRevision, setAddressRevision] = useState(0)

  const onAddressesPersisted = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['seed', 'items'], exact: false })
    setAddressRevision((n) => n + 1)
  }, [queryClient])

  useEffect(() => {
    eventEmitter.on(ADDRESSES_PERSISTED_EVENT, onAddressesPersisted)
    return () => {
      eventEmitter.off(ADDRESSES_PERSISTED_EVENT, onAddressesPersisted)
    }
  }, [onAddressesPersisted])

  return (
    <SeedAddressRevisionContext.Provider value={addressRevision}>
      {children}
    </SeedAddressRevisionContext.Provider>
  )
}

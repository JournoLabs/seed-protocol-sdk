import { useCallback, useRef, useSyncExternalStore } from 'react'
import { ClientManagerState, getClient } from '@seedprotocol/sdk'

type ClientService = ReturnType<ReturnType<typeof getClient>['getService']>
type ClientSnapshot = ReturnType<ClientService['getSnapshot']>

const subscribeToServiceChanges = (onChange: () => void) => getClient().subscribeService(onChange)
const getCurrentService = () => getClient().getService()

/**
 * The current clientManager actor. Re-renders when `client.init()` after `client.stop()`
 * replaces it, so hooks built on it follow the new client instead of the stopped one.
 */
export const useClientService = (): ClientService =>
  useSyncExternalStore(subscribeToServiceChanges, getCurrentService, getCurrentService)

/**
 * A value derived from the current clientManager snapshot. Follows actor swaps and `stop()`.
 * The selector must return a primitive or a stable reference: a new object on every call
 * re-renders forever.
 */
export function useClientSelector<T>(selector: (snapshot: ClientSnapshot) => T): T {
  const service = useClientService()
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = service.subscribe({ next: onChange, error: onChange, complete: onChange })
      // stop() may not emit a snapshot to subscribers; subscribeService reports it.
      const unsubscribeService = getClient().subscribeService(onChange)
      return () => {
        subscription.unsubscribe()
        unsubscribeService()
      }
    },
    [service],
  )
  const getSnapshot = () => selectorRef.current(service.getSnapshot())
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Whether a clientManager snapshot is a running client that finished init. */
export const isClientReadySnapshot = (snapshot: ClientSnapshot): boolean =>
  snapshot.status === 'active' && snapshot.value === ClientManagerState.IDLE

/**
 * Whether `client.init` has finished and the client is ready (idle). False after
 * `client.stop()` until the next init finishes. SeedClientGate uses it to hold back its
 * children; call it to wait for readiness in your own components.
 */
export const useIsClientReady = () => useClientSelector(isClientReadySnapshot)

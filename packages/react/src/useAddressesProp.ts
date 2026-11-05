import { useEffect, useRef, type MutableRefObject } from 'react'
import { client, normalizeAddressConfig } from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'

/** Whether a mount value holds an address, owned or watched. */
function hasAddresses(addresses: SeedConstructorOptions['addresses']): boolean {
  const { owned, watched } = normalizeAddressConfig(addresses)
  return owned.length > 0 || watched.length > 0
}

/** Whether the client's stored addresses already are `addresses`, in any order. */
async function storedAddressesMatch(addresses: SeedConstructorOptions['addresses']): Promise<boolean> {
  const wanted = normalizeAddressConfig(addresses)
  const stored = normalizeAddressConfig(await client.getAddresses())
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
  return same(wanted.owned, stored.owned) && same(wanted.watched, stored.watched)
}

/**
 * Applies a component's `addresses` prop. A first init applies the mount value; a repeat init (a
 * remount) leaves the stored addresses alone, so on mount this compares a value that holds an
 * address with the stored ones and calls `client.setAddresses` when they differ: an app that
 * unmounts its provider across a user switch gets the new user's addresses. An empty mount value
 * leaves the stored addresses, since apps pass `[]` before a wallet reconnects. After mount it calls
 * `client.setAddresses` whenever the prop holds different addresses. Every call waits for
 * `initRef`'s init and they apply in order. Leaving the prop out (`undefined`) changes nothing.
 */
export function useAddressesProp(
  addresses: SeedConstructorOptions['addresses'],
  initRef: MutableRefObject<Promise<void> | undefined>,
  label: string,
): void {
  const addressesRef = useRef(addresses)
  addressesRef.current = addresses
  const key = JSON.stringify(addresses ?? null)
  // The key the client was last given; starts as the mount's, which init applies
  const appliedKey = useRef(key)
  const queue = useRef<Promise<void>>(Promise.resolve())

  // In a ref, so the effects below run on mount and on a new key only
  const enqueueRef = useRef((value: NonNullable<SeedConstructorOptions['addresses']>, onlyIfStoredDiffer: boolean) => {
    queue.current = queue.current.then(async () => {
      try {
        await initRef.current
      } catch {
        // The init effect reports its own failure; there is no client to give addresses to
        return
      }
      try {
        if (onlyIfStoredDiffer && (await storedAddressesMatch(value))) return
        await client.setAddresses(value)
      } catch (err) {
        console.error(`[${label}] setAddresses failed`, err)
      }
    })
  })

  useEffect(() => {
    const value = addressesRef.current
    if (value !== undefined && hasAddresses(value)) enqueueRef.current(value, true)
  }, [])

  useEffect(() => {
    if (key === appliedKey.current) return
    appliedKey.current = key
    const value = addressesRef.current
    if (value === undefined) return
    enqueueRef.current(value, false)
  }, [key])
}

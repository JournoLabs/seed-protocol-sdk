import { useEffect, useRef, type MutableRefObject } from 'react'
import { client } from '@seedprotocol/sdk'
import type { SeedConstructorOptions } from '@seedprotocol/sdk'

/**
 * Applies a component's `addresses` prop after mount. The init the component starts on mount
 * applies the first value (a repeat init leaves the stored addresses alone), so this calls
 * `client.setAddresses` only when the prop later holds different addresses, after `initRef`'s
 * init settles. Changes apply in order. Leaving the prop out (`undefined`) changes nothing.
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

  useEffect(() => {
    if (key === appliedKey.current) return
    appliedKey.current = key
    const value = addressesRef.current
    if (value === undefined) return
    queue.current = queue.current.then(async () => {
      try {
        await initRef.current
      } catch {
        // The init effect reports its own failure; there is no client to give addresses to
        return
      }
      try {
        await client.setAddresses(value)
      } catch (err) {
        console.error(`[${label}] setAddresses failed`, err)
      }
    })
  }, [key])
}

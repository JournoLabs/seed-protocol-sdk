import { Item } from '@seedprotocol/sdk'
import type { AnyActorRef } from 'xstate'

/**
 * Holds `item` until `publish` stops: it reaches success or failure, or the manager stops it. Every
 * entry point goes through createPublish (publishItem, ensureWalletThenPublish, direct calls), so
 * an item a caller found without a hold doesn't unload after the grace period mid-upload. An item
 * that isn't cached takes no hold.
 */
export function holdItemUntilStopped(item: Item<any>, publish: AnyActorRef): void {
  if (!Item.retain(item)) return
  let released = false
  let subscription: { unsubscribe(): void } | undefined
  const release = () => {
    if (released) return
    released = true
    subscription?.unsubscribe()
    item.unload()
  }
  subscription = publish.subscribe({
    next: (snapshot: { status?: string }) => {
      if (snapshot.status !== 'active') release()
    },
    error: release,
    complete: release,
  })
  // An actor already done before the subscription delivers nothing
  if ((publish.getSnapshot() as { status?: string }).status !== 'active') release()
}

import { onTabMessage, postTabMessage } from '@/helpers/tabCoordinator'

/**
 * `@seedprotocol/publish` runs a seed's publish in the tab holding its Web Lock, and open tabs queue
 * for the lock of a publish another tab runs, to take it over if that tab closes (docs/MULTI_TAB.md).
 * A tab learns of publishes started after it loaded from these messages.
 */

/** Tells the other tabs of this database that this tab took the seed's publish lock. */
export function announcePublishLockTaken(seedLocalId: string): void {
  postTabMessage({ type: 'publish-lock-taken', seedLocalId })
}

/**
 * Calls `listener` with each seed another tab of this database took the publish lock of. Without
 * tab coordination (`multiTab: 'off'`, Node) nothing arrives. Returns the unsubscribe function.
 */
export function onPublishLockTaken(listener: (seedLocalId: string) => void): () => void {
  return onTabMessage((message) => {
    if (message.type === 'publish-lock-taken') listener(message.seedLocalId)
  })
}

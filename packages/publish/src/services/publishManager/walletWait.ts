import { getPublishWallet, onPublishAddressChange, publishAddressesOf } from '~/helpers/publishWalletRegistry'

/**
 * Publishes this tab doesn't run because its publish wallet doesn't publish as their address, or it
 * has none (ADR 0038). A publish resumed from its row attests as the address the row recorded
 * (`context.address`) with this tab's registered wallet, so a tab whose wallet publishes as another
 * address would attest under the wrong account. Such a publish is left: its row stays `in_progress`
 * and its lock free, and the tab queues for it again when its wallet comes to publish as that
 * address.
 *
 * seedLocalId → the lowercase address the publish runs as; `undefined` when this tab stopped
 * waiting for its lock (`stopAll`) without reading the row, so any wallet re-checks it.
 */
const waitingForWallet = new Map<string, string | undefined>()

let requeue: (seedLocalId: string) => void = () => {}

/** Set by the takeover, which queues for the seed's lock and checks the wallet again on the grant. */
export function setWalletRequeue(next: (seedLocalId: string) => void): void {
  requeue = next
}

/**
 * Whether this tab's publish wallet may publish as `address`, the address a saved publish runs as:
 * one of {@link publishAddressesOf}. A publish saved with no address can't attest whichever wallet
 * resumes it, so it passes.
 */
export function walletPublishesAs(address: unknown): boolean {
  if (typeof address !== 'string' || !address.trim()) return true
  return publishAddressesOf(getPublishWallet()).has(address.trim().toLowerCase())
}

/** Re-checks the seed's publish once this tab's wallet publishes as `address` (any wallet if unset). */
export function waitForWallet(seedLocalId: string, address?: unknown): void {
  waitingForWallet.set(
    seedLocalId,
    typeof address === 'string' && address.trim() ? address.trim().toLowerCase() : undefined,
  )
}

export function isWaitingForWallet(seedLocalId: string): boolean {
  return waitingForWallet.has(seedLocalId)
}

export function stopWaitingForWallet(seedLocalId: string): void {
  waitingForWallet.delete(seedLocalId)
}

onPublishAddressChange(() => {
  const addresses = publishAddressesOf(getPublishWallet())
  if (addresses.size === 0) return
  for (const [seedLocalId, waitsFor] of [...waitingForWallet]) {
    if (waitsFor === undefined || addresses.has(waitsFor)) requeue(seedLocalId)
  }
})

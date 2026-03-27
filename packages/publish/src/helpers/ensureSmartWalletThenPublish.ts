import type { Account } from 'thirdweb/wallets'
import type { Item } from '@seedprotocol/sdk'
import { resolveSmartWalletForPublish } from './thirdweb'
import { PublishManager } from '../services/publishManager'
import type { CreatePublishOptions } from '../config'

export type EnsureSmartWalletResult =
  | { outcome: 'started' }
  | { outcome: 'no_address' }
  | { outcome: 'needs_deploy' }

/**
 * Resolves the smart wallet for the current account; if deployed, starts publish.
 * If the user has no deployed ManagedAccount, returns needs_deploy so the caller can open the deploy modal.
 */
export async function ensureSmartWalletThenPublish(
  item: Item<any>,
  activeAccount: Account | null | undefined,
  getAddress: () => Promise<string | null>,
  options?: CreatePublishOptions,
): Promise<EnsureSmartWalletResult> {
  const address = await getAddress()
  if (!address || !address.trim()) {
    return { outcome: 'no_address' }
  }
  const resolved = await resolveSmartWalletForPublish(activeAccount ?? null)
  if ('address' in resolved) {
    PublishManager.createPublish(item, resolved.address, resolved.account, {
      dataItemSigner: resolved.account,
      ...options,
    })
    return { outcome: 'started' }
  }
  return { outcome: 'needs_deploy' }
}

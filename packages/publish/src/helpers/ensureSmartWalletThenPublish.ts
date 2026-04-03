import type { Account } from 'thirdweb/wallets'
import type { Item } from '@seedprotocol/sdk'
import { resolveSmartWalletForPublish } from './thirdweb'
import { PublishManager } from '../services/publishManager'
import type { CreatePublishOptions } from '../config'
import { getPublishConfig } from '../config'
import { runModularExecutorPublishPrep } from './ensureManagedAccountReady'
import { ManagedAccountPublishError } from '../errors'

export type EnsureSmartWalletResult =
  | { outcome: 'started' }
  | { outcome: 'no_address' }
  | { outcome: 'needs_deploy' }
  | { outcome: 'managed_not_ready'; error: ManagedAccountPublishError }

const MSG_NO_ACCOUNT_MODULAR =
  'A connected wallet is required for publishing with the modular executor. Connect your wallet and try again.'

/**
 * Resolves the smart wallet for the current account; if deployed, starts publish.
 * If the user has no deployed ManagedAccount (non-modular path), returns needs_deploy so the caller can open the deploy modal.
 *
 * When `useModularExecutor` is true, runs {@link runModularExecutorPublishPrep} first and uses the **managed** account
 * address as the publish `address` (context for `multiPublish`).
 *
 * Pass `options.publishMode`: `patch` (default) publishes only pending properties on the current Version;
 * `new_version` creates a new Version attestation and re-attests all properties (requires an existing Seed UID).
 */
export async function ensureSmartWalletThenPublish(
  item: Item<any>,
  activeAccount: Account | null | undefined,
  getAddress: () => Promise<string | null>,
  options?: CreatePublishOptions,
): Promise<EnsureSmartWalletResult> {
  const config = getPublishConfig()
  const address = await getAddress()
  if (!address || !address.trim()) {
    return { outcome: 'no_address' }
  }

  if (config.useModularExecutor) {
    if (!activeAccount) {
      return {
        outcome: 'managed_not_ready',
        error: new ManagedAccountPublishError(MSG_NO_ACCOUNT_MODULAR, 'MANAGED_ACCOUNT_UNAVAILABLE'),
      }
    }

    const prep = await runModularExecutorPublishPrep()
    if (!prep.ok) {
      return { outcome: 'managed_not_ready', error: prep.error }
    }

    const managedAddress = prep.managedAddress
    const resolved = await resolveSmartWalletForPublish(activeAccount ?? null)
    if ('needsDeploy' in resolved) {
      return { outcome: 'needs_deploy' }
    }

    PublishManager.createPublish(item, managedAddress, resolved.account, {
      dataItemSigner: resolved.account,
      ...options,
    })
    return { outcome: 'started' }
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

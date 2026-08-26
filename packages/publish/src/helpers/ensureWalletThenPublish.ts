import type { Item } from '@seedprotocol/sdk'
import { PublishManager } from '../services/publishManager'
import type { CreatePublishOptions } from '../config'
import { getPublishConfig } from '../config'
import { getPublishWallet } from './publishWalletRegistry'
import { isPublishWallet, isSeedSigner, type PublishWallet, type SeedSigner } from './seedSigner'
import { ethers } from 'ethers'
import { createPermissionlessTxSender } from './adapters/permissionlessTxSender'

export type EnsureWalletThenPublishResult =
  | { outcome: 'started' }
  | { outcome: 'no_address' }
  | { outcome: 'no_wallet' }

function coerceDataItemSigner(
  signer: CreatePublishOptions['dataItemSigner'] | SeedSigner | PublishWallet | undefined,
): CreatePublishOptions['dataItemSigner'] {
  if (!signer) return undefined
  if (signer instanceof ethers.Wallet) return signer
  if (isPublishWallet(signer)) return signer.signer
  if (isSeedSigner(signer)) return signer
  return undefined
}

/**
 * Vendor-neutral publish entry: uses the registered publish wallet (EIP-1193 / permissionless / ethers).
 * When `useModularExecutor` is true, callers should use the Thirdweb `ensureSmartWalletThenPublish` instead.
 */
export async function ensureWalletThenPublish(
  item: Item<any>,
  options?: CreatePublishOptions,
): Promise<EnsureWalletThenPublishResult> {
  const config = getPublishConfig()
  if (config.useModularExecutor) {
    // Modular / ManagedAccount Thirdweb bootstrap is adapter-only.
    const { ensureSmartWalletThenPublish } = await import('./ensureSmartWalletThenPublish')
    return ensureSmartWalletThenPublish(item, null, async () => {
      const w = getPublishWallet()
      return w?.publisherAddress ?? w?.signer.address ?? null
    }, options)
  }

  let session = getPublishWallet()
  if (!session) {
    return { outcome: 'no_wallet' }
  }

  // Upgrade EOA sender to permissionless EIP-7702 when configured.
  if (config.accountMode === 'eip7702' && config.bundlerUrl) {
    const sponsored = await createPermissionlessTxSender({
      signer: session.signer,
      bundlerUrl: config.bundlerUrl,
      paymasterUrl: config.paymasterUrl,
    })
    session = {
      ...session,
      txSender: sponsored,
      publisherAddress: session.publisherAddress ?? session.signer.address,
    }
  }

  const address =
    session.publisherAddress ?? session.txSender.address ?? session.signer.address
  if (!address?.trim()) {
    return { outcome: 'no_address' }
  }

  PublishManager.createPublish(item, address, session, {
    ...options,
    dataItemSigner: coerceDataItemSigner(options?.dataItemSigner) ?? session.signer,
  })
  return { outcome: 'started' }
}

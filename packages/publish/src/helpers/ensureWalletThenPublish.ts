import type { Item } from '@seedprotocol/sdk'
import { PublishManager } from '../services/publishManager'
import type { CreatePublishOptions } from '../config'
import { getPublishConfig } from '../config'
import { getPublishWallet } from './publishWalletRegistry'
import { isPublishWallet, isSeedSigner, type PublishWallet, type SeedSigner } from './seedSigner'
import { ethers } from 'ethers'
import { createPermissionlessTxSender } from './adapters/permissionlessTxSender'
import { resolvePublishPayment } from '../payment'
import type { ManagedAccountPublishError } from '../errors'

/**
 * `started` resolves with the spawned publish actor once it exists, or `undefined` when
 * that seed is already publishing in this tab or another. It does not wait for the
 * publish to finish; use {@link publishItem} (or `item.publish()`) for that.
 */
export type PublishStarted = Promise<import('xstate').ActorRef<any, any> | undefined>

export type EnsureWalletThenPublishResult =
  | { outcome: 'started'; started: PublishStarted }
  | { outcome: 'no_address' }
  | { outcome: 'no_wallet' }
  | { outcome: 'needs_deploy' }
  | { outcome: 'managed_not_ready'; error: ManagedAccountPublishError }

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
  const payment = resolvePublishPayment(config)
  if (payment.sender === 'modular') {
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
  if (payment.sender === 'eip7702') {
    const txSender = await createPermissionlessTxSender({
      signer: session.signer,
      bundlerUrl: config.bundlerUrl!,
      paymasterUrl: config.paymasterUrl,
      sponsored: payment.gas.payer === 'sponsored',
    })
    session = {
      ...session,
      txSender,
      publisherAddress: session.publisherAddress ?? session.signer.address,
    }
  }

  const address =
    session.publisherAddress ?? session.txSender.address ?? session.signer.address
  if (!address?.trim()) {
    return { outcome: 'no_address' }
  }

  const started = PublishManager.createPublish(item, address, session, {
    ...options,
    dataItemSigner: coerceDataItemSigner(options?.dataItemSigner) ?? session.signer,
  })
  return { outcome: 'started', started }
}

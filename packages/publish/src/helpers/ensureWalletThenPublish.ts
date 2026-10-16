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

/** @deprecated Already resolved: use the result's `publish`. */
export type PublishStarted = Promise<import('xstate').ActorRef<any, any> | undefined>

/**
 * `started`: the publish was spawned; `publish` is its actor. It hasn't finished: use
 * {@link publishItem} (or `item.publish()`) to wait for that. `already_publishing`: that seed is
 * already publishing in this tab or another, so nothing started.
 */
export type EnsureWalletThenPublishResult =
  | {
      outcome: 'started'
      publish: import('xstate').ActorRef<any, any>
      /** @deprecated Already resolved with `publish`. */
      started: PublishStarted
    }
  | { outcome: 'already_publishing' }
  | { outcome: 'no_address' }
  | { outcome: 'no_wallet' }
  | { outcome: 'needs_deploy' }
  | { outcome: 'managed_not_ready'; error: ManagedAccountPublishError }

/** Spawns the publish and reports whether it started (waits for the spawn, not the publish). */
export async function startPublish(
  ...args: Parameters<typeof PublishManager.createPublish>
): Promise<{ outcome: 'started'; publish: import('xstate').ActorRef<any, any>; started: PublishStarted } | { outcome: 'already_publishing' }> {
  const publish = await PublishManager.createPublish(...args)
  if (!publish) return { outcome: 'already_publishing' }
  return { outcome: 'started', publish, started: Promise.resolve(publish) }
}

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

  return startPublish(item, address, session, {
    ...options,
    dataItemSigner: coerceDataItemSigner(options?.dataItemSigner) ?? session.signer,
  })
}

import type { Account } from 'thirdweb/wallets'
import type { Item } from '@seedprotocol/sdk'
import { optimismSepolia } from 'thirdweb/chains'
import {
  getConnectedManagedAccountAddress,
  getConnectedModularAccount,
  resolveSmartWalletForPublish,
} from './thirdweb'
import { asSeedSigner, isSeedSigner, type SeedSigner } from './seedSigner'
import { ethers } from 'ethers'
import { PublishManager } from '../services/publishManager'
import type { CreatePublishOptions } from '../config'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'

export type EnsureSmartWalletResult =
  | { outcome: 'started' }
  | { outcome: 'no_address' }
  | { outcome: 'needs_deploy' }
  | { outcome: 'managed_not_ready'; error: ManagedAccountPublishError }

const MSG_NO_ACCOUNT_MODULAR =
  'A connected wallet is required for publishing with the modular executor. Connect your wallet and try again.'

const MSG_MANAGED_UNAVAILABLE =
  'Could not connect the managed publishing account on Optimism Sepolia. Reconnect with the same sign-in method and try again.'

function coerceDataItemSigner(
  signer: CreatePublishOptions['dataItemSigner'] | Account | SeedSigner | undefined,
): CreatePublishOptions['dataItemSigner'] {
  if (!signer) return undefined
  if (signer instanceof ethers.Wallet) return signer
  if (isSeedSigner(signer)) return signer
  return asSeedSigner(signer as Account)
}

/**
 * Resolves the smart wallet for the current account; if deployed, starts publish.
 * When **`useModularExecutor`** is true, wraps the modular Thirdweb Account as a SeedSigner at the boundary.
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
    const modularAccount = await getConnectedModularAccount()
    if (!modularAccount) {
      return {
        outcome: 'managed_not_ready',
        error: new ManagedAccountPublishError(MSG_NO_ACCOUNT_MODULAR, 'MANAGED_ACCOUNT_UNAVAILABLE'),
      }
    }

    let managedAddress: string
    try {
      managedAddress = await getConnectedManagedAccountAddress(optimismSepolia)
    } catch (cause) {
      return {
        outcome: 'managed_not_ready',
        error: new ManagedAccountPublishError(
          MSG_MANAGED_UNAVAILABLE,
          'MANAGED_ACCOUNT_UNAVAILABLE',
          undefined,
          cause,
        ),
      }
    }

    const signer = asSeedSigner(modularAccount)
    PublishManager.createPublish(item, managedAddress, signer, {
      ...options,
      dataItemSigner: coerceDataItemSigner(options?.dataItemSigner) ?? signer,
    })
    return { outcome: 'started' }
  }

  const resolved = await resolveSmartWalletForPublish(activeAccount ?? null)
  if ('address' in resolved) {
    const signer = asSeedSigner(resolved.account)
    PublishManager.createPublish(item, resolved.address, signer, {
      ...options,
      dataItemSigner: coerceDataItemSigner(options?.dataItemSigner) ?? signer,
    })
    return { outcome: 'started' }
  }
  return { outcome: 'needs_deploy' }
}

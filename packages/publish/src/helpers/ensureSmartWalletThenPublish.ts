import type { Item } from '@seedprotocol/sdk'
import type { Account } from 'thirdweb/wallets'
import { optimismSepolia } from 'thirdweb/chains'
import {
  getConnectedManagedAccountAddress,
  getConnectedModularAccount,
  resolveSmartWalletForPublish,
} from './thirdweb'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'
import { isPublishWallet, isSeedSigner, type PublishWallet, type SeedSigner } from './seedSigner'
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
  signer: CreatePublishOptions['dataItemSigner'] | Account | SeedSigner | PublishWallet | undefined,
): CreatePublishOptions['dataItemSigner'] {
  if (!signer) return undefined
  if (signer instanceof ethers.Wallet) return signer
  if (isPublishWallet(signer)) return signer.signer
  if (isSeedSigner(signer)) return signer
  return fromThirdwebAccount(signer as Account).signer
}

/**
 * Thirdweb path: resolves the smart wallet for the current account; if deployed, starts publish.
 * Prefer {@link ensureWalletThenPublish} for vendor-neutral entry.
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

    const wallet = fromThirdwebAccount(modularAccount)
    PublishManager.createPublish(item, managedAddress, wallet, {
      ...options,
      dataItemSigner: coerceDataItemSigner(options?.dataItemSigner) ?? wallet.signer,
    })
    return { outcome: 'started' }
  }

  const resolved = await resolveSmartWalletForPublish(activeAccount ?? null)
  if ('address' in resolved) {
    const wallet = fromThirdwebAccount(resolved.account)
    PublishManager.createPublish(item, resolved.address, wallet, {
      ...options,
      dataItemSigner: coerceDataItemSigner(options?.dataItemSigner) ?? wallet.signer,
    })
    return { outcome: 'started' }
  }
  return { outcome: 'needs_deploy' }
}

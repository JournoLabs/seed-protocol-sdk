import { zeroAddress, type Address } from 'viem'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { waitForPublishReceipt } from './chainClient'
import { encodeSetEas, readGetEas } from './contracts'
import {
  isPublishWallet,
  isSeedTxSender,
  type PublishWallet,
  type SeedTxSender,
} from './seedSigner'

const MSG_SET_EAS =
  'Could not verify or set the EAS contract address on your publishing account on Optimism Sepolia.'
const MSG_EAS_MISMATCH =
  'ManagedAccount EAS pointer does not match publish config. Configure EAS with the user’s ManagedAccount wallet before automation publish (session keys cannot call setEas).'

function normAddr(a: string): string {
  return a.toLowerCase()
}

function expectedEasFromConfig(managedAddress: string): string {
  const { easContractAddress } = getPublishConfig()
  const expected = normAddr(easContractAddress)
  if (!expected || expected === normAddr(zeroAddress)) {
    throw new ManagedAccountPublishError(
      'Publish config is missing a valid easContractAddress.',
      'MANAGED_ACCOUNT_SET_EAS_FAILED',
      managedAddress,
    )
  }
  return expected
}

async function readCurrentEas(managedAddress: string): Promise<string> {
  try {
    const raw = await readGetEas(managedAddress as Address)
    return normAddr(typeof raw === 'string' ? raw : String(raw))
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_SET_EAS, 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
  }
}

/**
 * Read-only: ManagedAccount `getEas` must already match config.
 * Use for automation session keys (module-only targets cannot `setEas`).
 */
export async function assertManagedAccountEasMatchesConfig(managedAddress: string): Promise<void> {
  const expected = expectedEasFromConfig(managedAddress)
  const current = await readCurrentEas(managedAddress)
  if (current === expected) return
  throw new ManagedAccountPublishError(MSG_EAS_MISMATCH, 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress)
}

/**
 * Ensures the ManagedAccount contract’s on-chain EAS address matches {@link getPublishConfig}.easContractAddress.
 * If `getEas` is zero or differs, sends `setEas` signed by `account` (same signer as modular `multiPublish`).
 */
export async function ensureManagedAccountEasConfigured(
  managedAddress: string,
  account: PublishWallet | SeedTxSender,
): Promise<void> {
  const txSender: SeedTxSender = isPublishWallet(account)
    ? account.txSender
    : isSeedTxSender(account)
      ? account
      : (() => {
          throw new Error(
            '@seedprotocol/publish: ensureManagedAccountEasConfigured requires PublishWallet or SeedTxSender',
          )
        })()
  const expected = expectedEasFromConfig(managedAddress)
  const current = await readCurrentEas(managedAddress)

  if (current === expected) {
    return
  }

  try {
    const { easContractAddress } = getPublishConfig()
    const tx = encodeSetEas(managedAddress as Address, easContractAddress as Address)
    const result = await txSender.sendTransaction(tx)
    await waitForPublishReceipt(result.transactionHash)
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_SET_EAS, 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
  }
}

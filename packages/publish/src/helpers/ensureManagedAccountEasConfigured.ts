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
import { getPublishChainName } from './chainConfig'

const MSG_SET_EAS = () =>
  `Could not verify or set the EAS contract address on your publishing account on ${getPublishChainName()}.`
const MSG_EAS_MISMATCH =
  'ManagedAccount EAS pointer does not match publish config. Configure EAS with the user’s ManagedAccount wallet before automation publish (session keys cannot call setEas).'
const MSG_FIXED_EAS_MISMATCH = (current: string) =>
  `Your publishing account's Seed extension uses EAS ${current}, but publish config sets easContractAddress to a different contract. The extension's EAS is fixed at deployment; fix easContractAddress.`

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
    throw new ManagedAccountPublishError(MSG_SET_EAS(), 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
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
 * Ensures the ManagedAccount's `getEas()` matches {@link getPublishConfig}.easContractAddress.
 *
 * Current Seed extensions fix EAS at deployment and have no `setEas`, so a mismatch is a config
 * error and nothing is sent. Only accounts on the pre-rollout extension, which report the zero
 * address until configured, get `setEas` sent by `account` (an account admin).
 */
export async function ensureManagedAccountEasConfigured(
  managedAddress: string,
  /** Sender for the pre-rollout `setEas` fallback; a function is only called when it is needed. */
  account: PublishWallet | SeedTxSender | (() => Promise<PublishWallet | SeedTxSender>),
): Promise<void> {
  const expected = expectedEasFromConfig(managedAddress)
  const current = await readCurrentEas(managedAddress)

  if (current === expected) {
    return
  }
  if (current !== normAddr(zeroAddress)) {
    throw new ManagedAccountPublishError(
      MSG_FIXED_EAS_MISMATCH(current),
      'MANAGED_ACCOUNT_SET_EAS_FAILED',
      managedAddress,
    )
  }

  try {
    const sender = typeof account === 'function' ? await account() : account
    const txSender: SeedTxSender = isPublishWallet(sender)
      ? sender.txSender
      : isSeedTxSender(sender)
        ? sender
        : (() => {
            throw new Error(
              '@seedprotocol/publish: ensureManagedAccountEasConfigured requires PublishWallet or SeedTxSender',
            )
          })()
    const { easContractAddress } = getPublishConfig()
    const tx = encodeSetEas(managedAddress as Address, easContractAddress as Address)
    const result = await txSender.sendTransaction(tx)
    await waitForPublishReceipt(result.transactionHash)
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_SET_EAS(), 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
  }
}

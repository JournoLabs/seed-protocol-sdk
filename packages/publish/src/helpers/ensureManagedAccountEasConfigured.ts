import { zeroAddress, type Address } from 'viem'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { waitForPublishReceipt } from './chainClient'
import { encodeSetEas, readGetEas } from './contracts'
import type { SeedSigner } from './seedSigner'
import { asSeedSigner } from './seedSigner'

const MSG_SET_EAS =
  'Could not verify or set the EAS contract address on your publishing account on Optimism Sepolia.'

function normAddr(a: string): string {
  return a.toLowerCase()
}

/**
 * Ensures the ManagedAccount contract’s on-chain EAS address matches {@link getPublishConfig}.easContractAddress.
 * If `getEas` is zero or differs, sends `setEas` signed by `account` (same signer as modular `multiPublish`).
 */
export async function ensureManagedAccountEasConfigured(
  managedAddress: string,
  account: SeedSigner | Parameters<typeof asSeedSigner>[0],
): Promise<void> {
  const signer = asSeedSigner(account)
  const { easContractAddress } = getPublishConfig()
  const expected = normAddr(easContractAddress)
  if (!expected || expected === normAddr(zeroAddress)) {
    throw new ManagedAccountPublishError(
      'Publish config is missing a valid easContractAddress.',
      'MANAGED_ACCOUNT_SET_EAS_FAILED',
      managedAddress,
    )
  }

  let current: string
  try {
    const raw = await readGetEas(managedAddress as Address)
    current = normAddr(typeof raw === 'string' ? raw : String(raw))
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_SET_EAS, 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
  }

  if (current === expected) {
    return
  }

  try {
    const tx = encodeSetEas(managedAddress as Address, easContractAddress as Address)
    const result = await signer.sendTransaction(tx)
    await waitForPublishReceipt(result.transactionHash)
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_SET_EAS, 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
  }
}

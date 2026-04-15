import { getContract, sendTransaction, waitForReceipt } from 'thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import type { Account } from 'thirdweb/wallets'
import { zeroAddress } from 'viem'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { getClient } from './thirdweb'
import {
  getEas,
  setEas,
} from './thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'

const MSG_SET_EAS =
  'Could not verify or set the EAS contract address on your publishing account on Optimism Sepolia.'

function normAddr(a: string): string {
  return a.toLowerCase()
}

/**
 * Ensures the ManagedAccount contract’s on-chain EAS address matches {@link getPublishConfig}.easContractAddress.
 * If `getEas` is zero or differs, sends `setEas` signed by `account` (same signer as modular `multiPublish`).
 *
 * Call only on the modular executor path, after {@link ensureEip7702ModularAccountReady}.
 */
export async function ensureManagedAccountEasConfigured(
  managedAddress: string,
  account: Account,
): Promise<void> {
  const { easContractAddress } = getPublishConfig()
  const expected = normAddr(easContractAddress)
  if (!expected || expected === normAddr(zeroAddress)) {
    throw new ManagedAccountPublishError(
      'Publish config is missing a valid easContractAddress.',
      'MANAGED_ACCOUNT_SET_EAS_FAILED',
      managedAddress,
    )
  }

  const contract = getContract({
    client: getClient(),
    chain: optimismSepolia,
    address: managedAddress,
  })

  let current: string
  try {
    const raw = await getEas({ contract })
    current = normAddr(typeof raw === 'string' ? raw : String(raw))
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_SET_EAS, 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
  }

  if (current === expected) {
    return
  }

  try {
    const tx = setEas({
      contract,
      eas: easContractAddress as `0x${string}`,
    })
    const result = await sendTransaction({ transaction: tx, account })
    await waitForReceipt({
      client: getClient(),
      transactionHash: result.transactionHash,
      chain: optimismSepolia,
    })
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_SET_EAS, 'MANAGED_ACCOUNT_SET_EAS_FAILED', managedAddress, cause)
  }
}

import { getContract, sendTransaction } from 'thirdweb'
import {
  addSessionKey,
  removeSessionKey,
  shouldUpdateSessionKey,
} from 'thirdweb/extensions/erc4337'
import { optimismSepolia } from 'thirdweb/chains'
import type { Address } from 'viem'
import { ManagedAccountPublishError } from '../errors'
import { waitForPublishReceipt } from './chainClient'
import { readIsActiveSigner } from './contracts'
import {
  buildAutomationSessionKeyPermissions,
  toThirdwebSessionKeyPermissions,
} from './automationSessionKeyPermissions'
import { getClient, getManagedAccountWallet } from './thirdweb'

const MSG_UNAVAILABLE =
  'Could not connect the managed publishing account to authorize an automation session key on Optimism Sepolia. Reconnect and try again.'
const MSG_ACTIVATION_FAILED =
  'Could not authorize the automation session key on your publishing account on Optimism Sepolia.'
const MSG_REMOVAL_FAILED =
  'Could not remove the automation session key from your publishing account on Optimism Sepolia.'

async function getManagedAccountForSessionKeyAdmin(managedAddress: string) {
  const managedWallet = getManagedAccountWallet()
  await managedWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
  const managedAccount = managedWallet.getAccount()
  if (!managedAccount) {
    throw new ManagedAccountPublishError(
      MSG_UNAVAILABLE,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
    )
  }
  return managedAccount
}

/**
 * Ensures `sessionKeyAddress` is an active automation session signer on the ManagedAccount
 * with **executor-module-only** approved targets. Signed by the managed EIP-4337 wallet (user).
 */
export async function ensureAutomationSessionKey(params: {
  managedAddress: string
  sessionKeyAddress: string
  /** Unix seconds end time for the session key (optional). */
  expiresAt?: number
}): Promise<void> {
  const { managedAddress, sessionKeyAddress, expiresAt } = params
  const managedAccount = await getManagedAccountForSessionKeyAdmin(managedAddress)

  const accountContract = getContract({
    client: getClient(),
    chain: optimismSepolia,
    address: managedAddress,
  })
  const permissions = toThirdwebSessionKeyPermissions(
    buildAutomationSessionKeyPermissions({ expiresAt }),
  )

  let shouldUpdate = false
  try {
    shouldUpdate = await shouldUpdateSessionKey({
      accountContract,
      sessionKeyAddress,
      newPermissions: permissions,
    })
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }

  if (shouldUpdate) {
    try {
      const tx = addSessionKey({
        contract: accountContract,
        account: managedAccount,
        sessionKeyAddress,
        permissions,
      })
      const result = await sendTransaction({ account: managedAccount, transaction: tx })
      await waitForPublishReceipt(result.transactionHash as `0x${string}`)
    } catch (cause) {
      throw new ManagedAccountPublishError(
        MSG_ACTIVATION_FAILED,
        'MODULAR_SIGNER_ACTIVATION_FAILED',
        managedAddress,
        cause,
      )
    }
  }

  const active = await isAutomationSessionActive(managedAddress, sessionKeyAddress)
  if (!active) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
    )
  }
}

/**
 * Removes an automation session key from the ManagedAccount (user-signed via managed wallet).
 */
export async function removeAutomationSessionKey(params: {
  managedAddress: string
  sessionKeyAddress: string
}): Promise<void> {
  const { managedAddress, sessionKeyAddress } = params
  const managedAccount = await getManagedAccountForSessionKeyAdmin(managedAddress)

  const accountContract = getContract({
    client: getClient(),
    chain: optimismSepolia,
    address: managedAddress,
  })

  try {
    const tx = removeSessionKey({
      contract: accountContract,
      account: managedAccount,
      sessionKeyAddress,
    })
    const result = await sendTransaction({ account: managedAccount, transaction: tx })
    await waitForPublishReceipt(result.transactionHash as `0x${string}`)
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_REMOVAL_FAILED,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }
}

/** True when `sessionKeyAddress` is an active signer on the ManagedAccount. */
export async function isAutomationSessionActive(
  managedAddress: string,
  sessionKeyAddress: string,
): Promise<boolean> {
  try {
    return await readIsActiveSigner(
      managedAddress as Address,
      sessionKeyAddress as Address,
    )
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }
}

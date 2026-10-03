import { getContract, sendTransaction } from 'thirdweb'
import { addSessionKey, shouldUpdateSessionKey } from 'thirdweb/extensions/erc4337'
import type { Address } from 'viem'
import { ManagedAccountPublishError } from '../errors'
import { waitForPublishReceipt } from './chainClient'
import { readIsActiveSigner } from './contracts'
import { defaultApprovedTargetsForModularPublish } from './defaultApprovedTargetsForModularPublish'
import { getClient, getManagedAccountWallet } from './thirdweb'
import { getPublishThirdwebChain } from './thirdwebChain'
import { getPublishChainName } from './chainConfig'

const MSG_UNAVAILABLE = () =>
  `Could not connect the managed publishing account to authorize the modular signer on ${getPublishChainName()}. Reconnect and try again.`
const MSG_ACTIVATION_FAILED = () =>
  `Could not authorize the modular wallet as a session signer on your publishing account on ${getPublishChainName()}.`

/**
 * Ensures the modular (EIP-7702) wallet is an active session signer on the ManagedAccount.
 * If permissions are missing or stale, sends `addSessionKey` signed by the managed EIP-4337 wallet.
 * Session-key AA extensions remain on Thirdweb; verification uses viem.
 *
 * The key may call only the Seed executor module ({@link defaultApprovedTargetsForModularPublish}).
 *
 * @deprecated Interactive publishing is a UserOp from the ManagedAccount itself and needs no
 * session key. For server-held keys use `enrollPublishAutomation`.
 */
export async function ensureManagedSignerSessionKey(params: {
  managedAddress: string
  signerAddress: string
}): Promise<void> {
  const { managedAddress, signerAddress } = params
  const managedWallet = getManagedAccountWallet()
  await managedWallet.autoConnect({ client: getClient(), chain: getPublishThirdwebChain() })
  const managedAccount = managedWallet.getAccount()
  if (!managedAccount) {
    throw new ManagedAccountPublishError(
      MSG_UNAVAILABLE(),
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
    )
  }

  const accountContract = getContract({
    client: getClient(),
    chain: getPublishThirdwebChain(),
    address: managedAddress,
  })
  const permissions = {
    approvedTargets: defaultApprovedTargetsForModularPublish(managedAddress),
    nativeTokenLimitPerTransaction: 0,
  }

  let shouldUpdate = false
  try {
    shouldUpdate = await shouldUpdateSessionKey({
      accountContract,
      sessionKeyAddress: signerAddress,
      newPermissions: permissions,
    })
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED(),
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
        sessionKeyAddress: signerAddress,
        permissions,
      })
      const result = await sendTransaction({ account: managedAccount, transaction: tx })
      await waitForPublishReceipt(result.transactionHash as `0x${string}`)
    } catch (cause) {
      throw new ManagedAccountPublishError(
        MSG_ACTIVATION_FAILED(),
        'MODULAR_SIGNER_ACTIVATION_FAILED',
        managedAddress,
        cause,
      )
    }
  }

  let active = false
  try {
    active = await readIsActiveSigner(managedAddress as Address, signerAddress as Address)
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED(),
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }

  if (!active) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED(),
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
    )
  }
}

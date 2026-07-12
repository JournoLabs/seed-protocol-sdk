import { getContract, sendTransaction, waitForReceipt } from 'thirdweb'
import { addSessionKey, shouldUpdateSessionKey } from 'thirdweb/extensions/erc4337'
import { optimismSepolia } from 'thirdweb/chains'
import { ManagedAccountPublishError } from '../errors'
import { defaultApprovedTargetsForModularPublish } from './defaultApprovedTargetsForModularPublish'
import { getClient, getManagedAccountWallet } from './thirdweb'
import { isActiveSigner } from './thirdweb/11155420/0xcd8c945872df8e664e55cf8885c85ea3ea8f2148'

const MSG_UNAVAILABLE =
  'Could not connect the managed publishing account to authorize the modular signer on Optimism Sepolia. Reconnect and try again.'
const MSG_ACTIVATION_FAILED =
  'Could not authorize the modular wallet as a session signer on your publishing account on Optimism Sepolia.'

/**
 * Ensures the modular (EIP-7702) wallet is an active session signer on the ManagedAccount.
 * If permissions are missing or stale, sends `addSessionKey` signed by the managed EIP-4337 wallet.
 */
export async function ensureManagedSignerSessionKey(params: {
  managedAddress: string
  signerAddress: string
}): Promise<void> {
  const { managedAddress, signerAddress } = params
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

  const accountContract = getContract({
    client: getClient(),
    chain: optimismSepolia,
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
        sessionKeyAddress: signerAddress,
        permissions,
      })
      const result = await sendTransaction({ account: managedAccount, transaction: tx })
      await waitForReceipt({
        client: getClient(),
        chain: optimismSepolia,
        transactionHash: result.transactionHash,
      })
    } catch (cause) {
      throw new ManagedAccountPublishError(
        MSG_ACTIVATION_FAILED,
        'MODULAR_SIGNER_ACTIVATION_FAILED',
        managedAddress,
        cause,
      )
    }
  }

  let active = false
  try {
    active = await isActiveSigner({ contract: accountContract, signer: signerAddress })
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }

  if (!active) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED,
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
    )
  }
}

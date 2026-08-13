import { deploySmartAccount, getContract } from 'thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { getPublishConfig } from '../config'
import { Eip7702ModularAccountPublishError } from '../errors'
import { isContractDeployed, pollSmartWalletDeployed } from './chainClient'
import { getClient, getModularAccountWallet } from './thirdweb'

const MSG_NO_ACCOUNT =
  'Modular (EIP-7702) wallet is not connected. Sign in with the same method and try again.'
const MSG_NOT_UPGRADED =
  'Your modular account is not upgraded to an EIP-7702 smart account on Optimism Sepolia yet. Enable autoDeployEip7702ModularAccount in publish config or complete wallet setup, then retry.'
const MSG_DEPLOY_FAILED =
  'Automatic EIP-7702 smart account setup failed on Optimism Sepolia. Retry or reconnect your wallet.'
const MSG_NOT_CONFIRMED =
  'EIP-7702 upgrade was sent but on-chain bytecode was not detected yet. Wait a moment and retry.'

const DEPLOY_POLL_ATTEMPTS = 5

/**
 * Ensures the Thirdweb in-app modular wallet (EIP-7702) has non-empty bytecode at its address
 * on Optimism Sepolia. deploySmartAccount remains Thirdweb; bytecode checks use viem.
 */
export async function ensureEip7702ModularAccountReady(): Promise<void> {
  const { autoDeployEip7702ModularAccount } = getPublishConfig()
  const modularAccountWallet = getModularAccountWallet()
  await modularAccountWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
  const modularAccount = modularAccountWallet.getAccount()
  if (!modularAccount) {
    throw new Eip7702ModularAccountPublishError(MSG_NO_ACCOUNT, 'EIP7702_MODULAR_ACCOUNT_UNAVAILABLE')
  }

  const client = getClient()
  const accountContract = getContract({
    client,
    chain: optimismSepolia,
    address: modularAccount.address,
  })

  if (await isContractDeployed(modularAccount.address)) {
    return
  }

  if (!autoDeployEip7702ModularAccount) {
    throw new Eip7702ModularAccountPublishError(
      MSG_NOT_UPGRADED,
      'EIP7702_MODULAR_NOT_UPGRADED',
      modularAccount.address,
    )
  }

  try {
    await deploySmartAccount({
      smartAccount: modularAccount,
      chain: optimismSepolia,
      client,
      accountContract,
    })
  } catch (cause) {
    if (await pollSmartWalletDeployed(modularAccount.address, DEPLOY_POLL_ATTEMPTS)) {
      return
    }
    throw new Eip7702ModularAccountPublishError(
      MSG_DEPLOY_FAILED,
      'EIP7702_MODULAR_DEPLOY_FAILED',
      modularAccount.address,
      cause,
    )
  }

  if (!(await pollSmartWalletDeployed(modularAccount.address, DEPLOY_POLL_ATTEMPTS))) {
    throw new Eip7702ModularAccountPublishError(
      MSG_NOT_CONFIRMED,
      'EIP7702_MODULAR_NOT_CONFIRMED',
      modularAccount.address,
    )
  }
}

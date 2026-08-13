import { getContract, sendTransaction } from 'thirdweb'
import { getInstalledModules, installModule } from 'thirdweb/modules'
import { optimismSepolia } from 'thirdweb/chains'
import type { Account } from 'thirdweb/wallets'
import { encodeAbiParameters } from 'viem'
import { waitForPublishReceipt, isContractDeployed } from './chainClient'
import { getClient } from './thirdweb'
import { EAS_CONTRACT_ADDRESS } from './constants'
import type { PublishConfig } from '../config'
import { isRouterNonModularCoreAccountError, ManagedAccountPublishError } from '../errors'

const MODULE_INSTALL_MSG =
  'The executor module could not be installed on your publishing account on Optimism Sepolia. Reconnect and try again, or contact support if this persists.'

/**
 * Ensures `modularAccountModuleContract` is installed on `contractAddress` when that contract
 * implements Thirdweb ModularCore. Module install AA APIs remain on Thirdweb; deploy check / receipt via viem.
 */
export async function ensureExecutorModuleInstalled(
  contractAddress: string,
  account: Account,
  config: Pick<PublishConfig, 'modularAccountModuleContract'>,
): Promise<void> {
  const { modularAccountModuleContract } = config
  if (!modularAccountModuleContract) return

  const accountContract = getContract({
    client: getClient(),
    chain: optimismSepolia,
    address: contractAddress,
  })

  const deployed = await isContractDeployed(contractAddress)
  if (!deployed) {
    return
  }

  try {
    const installed = await getInstalledModules({ contract: accountContract })
    const moduleAddr = modularAccountModuleContract.toLowerCase()
    const isInstalled = installed.some(
      (m: { implementation: string }) => m.implementation?.toLowerCase() === moduleAddr,
    )
    if (isInstalled) return

    const tx = installModule({
      contract: accountContract,
      moduleContract: modularAccountModuleContract,
      data: encodeAbiParameters([{ type: 'address' }], [EAS_CONTRACT_ADDRESS]),
    })
    const result = await sendTransaction({ transaction: tx, account })
    await waitForPublishReceipt(result.transactionHash as `0x${string}`)
  } catch (cause) {
    if (isRouterNonModularCoreAccountError(cause)) {
      return
    }
    throw new ManagedAccountPublishError(
      MODULE_INSTALL_MSG,
      'EXECUTOR_MODULE_NOT_INSTALLED',
      contractAddress,
      cause,
    )
  }
}

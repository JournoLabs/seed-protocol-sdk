import { getContract, sendTransaction, waitForReceipt } from 'thirdweb'
import { getInstalledModules, installModule } from 'thirdweb/modules'
import { optimismSepolia } from 'thirdweb/chains'
import type { Account } from 'thirdweb/wallets'
import { encodeAbiParameters } from 'viem'
import { getClient } from './thirdweb'
import { EAS_CONTRACT_ADDRESS } from './constants'
import type { PublishConfig } from '../config'
import { isRouterNonModularCoreAccountError, ManagedAccountPublishError } from '../errors'

const MODULE_INSTALL_MSG =
  'The executor module could not be installed on your publishing account on Optimism Sepolia. Reconnect and try again, or contact support if this persists.'

/**
 * Ensures `modularAccountModuleContract` is installed on `contractAddress` when that contract
 * implements Thirdweb ModularCore (`getInstalledModules` / Router). If the account does not
 * support ModularCore (RPC error `Router: function does not exist`), this is a **no-op** — many
 * EIP-4337 managed accounts embed `multiPublish` without pluggable modules.
 *
 * No-op if `modularAccountModuleContract` is unset.
 *
 * @param contractAddress - Account contract to inspect (typically the managed smart account)
 * @param account - Account that can sign `installModule` for that contract
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
    await waitForReceipt({
      client: getClient(),
      transactionHash: result.transactionHash,
      chain: optimismSepolia,
    })
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

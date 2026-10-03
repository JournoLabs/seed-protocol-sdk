import { getContract, sendTransaction } from 'thirdweb'
import { getInstalledModules, installModule } from 'thirdweb/modules'
import type { Account } from 'thirdweb/wallets'
import { encodeAbiParameters, type Address } from 'viem'
import { waitForPublishReceipt, isContractDeployed } from './chainClient'
import { getClient } from './thirdweb'
import { getPublishConfig, type PublishConfig } from '../config'
import { isRouterNonModularCoreAccountError, ManagedAccountPublishError } from '../errors'
import { getPublishThirdwebChain } from './thirdwebChain'
import { getPublishChainName } from './chainConfig'
import {
  encodeInstallSeedExecutor,
  readSeedExecutorInstalled,
  readSeedExecutorRouter,
} from './contracts'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'

const MODULE_INSTALL_MSG = () =>
  `The executor module could not be installed on your publishing account on ${getPublishChainName()}. Reconnect and try again, or contact support if this persists.`

/**
 * Ensures `modularAccountModuleContract` is installed on `contractAddress`:
 * - Router accounts with the `SeedExecutorRouterExtension`: `installSeedExecutor()`, sent by the
 *   account's admin EOA (the extension rejects self-calls). `account` is not used on this path.
 * - Thirdweb ModularCore accounts: `installModule`, sent by `account`.
 * - Other Router accounts (no extension): nothing to install; skipped.
 */
export async function ensureExecutorModuleInstalled(
  contractAddress: string,
  account: Account,
  config: Pick<PublishConfig, 'modularAccountModuleContract'>,
): Promise<void> {
  const { modularAccountModuleContract } = config
  if (!modularAccountModuleContract) return

  if (!(await isContractDeployed(contractAddress))) {
    return
  }

  const router = await readSeedExecutorRouter(contractAddress as Address)
  if (router) {
    await installViaRouterExtension(contractAddress, router.executor, modularAccountModuleContract)
    return
  }

  const accountContract = getContract({
    client: getClient(),
    chain: getPublishThirdwebChain(),
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
      data: encodeAbiParameters([{ type: 'address' }], [getPublishConfig().easContractAddress as `0x${string}`]),
    })
    const result = await sendTransaction({ transaction: tx, account })
    await waitForPublishReceipt(result.transactionHash as `0x${string}`)
  } catch (cause) {
    if (isRouterNonModularCoreAccountError(cause)) {
      return
    }
    throw new ManagedAccountPublishError(
      MODULE_INSTALL_MSG(),
      'EXECUTOR_MODULE_NOT_INSTALLED',
      contractAddress,
      cause,
    )
  }
}

async function installViaRouterExtension(
  contractAddress: string,
  pinnedExecutor: Address,
  configuredModule: string,
): Promise<void> {
  if (pinnedExecutor.toLowerCase() !== configuredModule.trim().toLowerCase()) {
    throw new ManagedAccountPublishError(
      `Your publishing account's Seed executor is ${pinnedExecutor}, but publish config sets modularAccountModuleContract to ${configuredModule}. Point modularAccountModuleContract at the account's executor.`,
      'EXECUTOR_MODULE_NOT_INSTALLED',
      contractAddress,
    )
  }
  try {
    if (await readSeedExecutorInstalled(contractAddress as Address, pinnedExecutor)) return
    const { getManagedAccountAdmin } = await import('./managedAccountAdmin')
    const admin = fromThirdwebAccount(await getManagedAccountAdmin(contractAddress))
    const result = await admin.txSender.sendTransaction(
      encodeInstallSeedExecutor(contractAddress as Address),
    )
    await waitForPublishReceipt(result.transactionHash)
  } catch (cause) {
    if (cause instanceof ManagedAccountPublishError) throw cause
    throw new ManagedAccountPublishError(
      MODULE_INSTALL_MSG(),
      'EXECUTOR_MODULE_NOT_INSTALLED',
      contractAddress,
      cause,
    )
  }
}

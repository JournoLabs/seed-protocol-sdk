import type { Account } from 'thirdweb/wallets'
import { isAddressEqual, parseEventLogs, type Address, type TransactionReceipt } from 'viem'
import { waitForPublishReceipt, isContractDeployed } from './chainClient'
import type { PublishConfig } from '../config'
import { ManagedAccountPublishError, PublishTransactionRevertedError } from '../errors'
import { getPublishChainName } from './chainConfig'
import {
  encodeInstallSeedExecutor,
  readSeedExecutorInstalled,
  readSeedExecutorRouter,
} from './contracts'
import { executorModuleAbi } from './abi/executor'
import { seedExecutorRouterAbi } from './abi/seedExecutorRouter'
import { describeRevert, findRevertData } from './describeRevert'
import { simulateCallFromAccount } from './executorModuleReadiness'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'

const MODULE_INSTALL_MSG = () =>
  `The executor module could not be installed on your publishing account on ${getPublishChainName()}. Reconnect and try again, or contact support if this persists.`

export type EnsureExecutorModuleResult =
  /** Nothing to do: no module configured, account not deployed, or account without the extension. */
  | { status: 'skipped' }
  | { status: 'already-installed' }
  /** Installed by this call, confirmed from the receipt's logs. `eas` is what the executor was initialized with. */
  | { status: 'installed'; eas: Address; transactionHash: string }

/**
 * Ensures `modularAccountModuleContract` is installed on `contractAddress`:
 * - Router accounts with the `SeedExecutorRouterExtension`: `installSeedExecutor()`, sent by the
 *   account's admin EOA (the extension rejects self-calls). The install is confirmed from the
 *   receipt's logs, not a follow-up read, so a lagging RPC node cannot make it look missing.
 * - Any other account: nothing to install; skipped. `assertExecutorModuleReadyForAccount` reports
 *   why the executor cannot act for it.
 *
 * @param _account unused; kept for compatibility
 * @throws ManagedAccountPublishError `EXECUTOR_MODULE_NOT_INSTALLED` when the install fails
 */
export async function ensureExecutorModuleInstalled(
  contractAddress: string,
  _account: Account,
  config: Pick<PublishConfig, 'modularAccountModuleContract'>,
): Promise<EnsureExecutorModuleResult> {
  const { modularAccountModuleContract } = config
  if (!modularAccountModuleContract) return { status: 'skipped' }

  if (!(await isContractDeployed(contractAddress))) {
    return { status: 'skipped' }
  }

  const router = await readSeedExecutorRouter(contractAddress as Address)
  if (!router) return { status: 'skipped' }
  return installViaRouterExtension(contractAddress, router.executor, modularAccountModuleContract)
}

async function installViaRouterExtension(
  contractAddress: string,
  pinnedExecutor: Address,
  configuredModule: string,
): Promise<EnsureExecutorModuleResult> {
  if (pinnedExecutor.toLowerCase() !== configuredModule.trim().toLowerCase()) {
    throw new ManagedAccountPublishError(
      `Your publishing account's Seed executor is ${pinnedExecutor}, but publish config sets modularAccountModuleContract to ${configuredModule}. Point modularAccountModuleContract at the account's executor.`,
      'EXECUTOR_MODULE_NOT_INSTALLED',
      contractAddress,
    )
  }
  const account = contractAddress as Address
  let admin: Address
  let receipt: TransactionReceipt | undefined
  let transactionHash: string
  try {
    if (await readSeedExecutorInstalled(account, pinnedExecutor)) return { status: 'already-installed' }
    const { getManagedAccountAdmin } = await import('./managedAccountAdmin')
    const wallet = fromThirdwebAccount(await getManagedAccountAdmin(contractAddress))
    admin = wallet.txSender.address as Address
    const result = await wallet.txSender.sendTransaction(encodeInstallSeedExecutor(account))
    transactionHash = result.transactionHash
    try {
      receipt = await waitForPublishReceipt(result.transactionHash)
    } catch (err) {
      if (!(err instanceof PublishTransactionRevertedError)) throw err
    }
  } catch (cause) {
    if (cause instanceof ManagedAccountPublishError) throw cause
    throw new ManagedAccountPublishError(
      MODULE_INSTALL_MSG(),
      'EXECUTOR_MODULE_NOT_INSTALLED',
      contractAddress,
      cause,
    )
  }

  const eas = receipt && installedEasFromReceipt(receipt, account, pinnedExecutor)
  if (eas) return { status: 'installed', eas, transactionHash }

  // No install in the receipt: the transaction reverted, or (sponsored sends) the relayer's
  // transaction succeeded but the inner call did not. Re-run the call to find out why.
  const reason = await simulateInstallSeedExecutor(account, admin)
  if (reason === 'already-installed') return { status: 'already-installed' }
  throw new ManagedAccountPublishError(
    `installSeedExecutor in transaction ${transactionHash} did not install the Seed executor on ${contractAddress}${reason ? `: ${reason}` : ''}.`,
    'EXECUTOR_MODULE_NOT_INSTALLED',
    contractAddress,
  )
}

/**
 * The EAS the executor was initialized with for `account`, when `receipt` shows the install:
 * the account's `SeedExecutorInstalled(executor)` and the executor's `ModuleInitialized(account, eas)`.
 */
export function installedEasFromReceipt(
  receipt: Pick<TransactionReceipt, 'logs'>,
  account: Address,
  executor: Address,
): Address | undefined {
  const installed = parseEventLogs({
    abi: seedExecutorRouterAbi,
    eventName: 'SeedExecutorInstalled',
    logs: receipt.logs,
    strict: false,
  }).some((log) => isAddressEqual(log.address, account) && log.args.executor && isAddressEqual(log.args.executor, executor))
  if (!installed) return undefined
  const initialized = parseEventLogs({
    abi: executorModuleAbi,
    eventName: 'ModuleInitialized',
    logs: receipt.logs,
    strict: false,
  }).find((log) => isAddressEqual(log.address, executor) && log.args.account && isAddressEqual(log.args.account, account))
  return initialized?.args.eas
}

/**
 * Simulates `installSeedExecutor` from `admin`. Returns 'already-installed' when it reverts with
 * `SeedExecutorAlreadyInstalled`, else the revert description, or undefined when the call would
 * succeed or cannot be simulated.
 */
async function simulateInstallSeedExecutor(
  account: Address,
  admin: Address,
): Promise<'already-installed' | string | undefined> {
  try {
    await simulateCallFromAccount({
      managedAddress: admin,
      tx: encodeInstallSeedExecutor(account),
      action: 'installSeedExecutor',
      requireSimulation: false,
    })
    return undefined
  } catch (err) {
    const cause = err instanceof ManagedAccountPublishError ? err.underlyingCause : err
    const reason = describeRevert(findRevertData(cause))
    return reason === 'reverted with SeedExecutorAlreadyInstalled' ? 'already-installed' : reason
  }
}

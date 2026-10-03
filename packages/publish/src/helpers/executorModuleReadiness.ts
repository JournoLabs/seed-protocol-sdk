import { BaseError, decodeErrorResult, parseEther, zeroAddress, type Address, type Hex } from 'viem'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { easAbi } from './abi/eas'
import { executorModuleAbi } from './abi/executor'
import { getPublishPublicClient } from './chainClient'
import {
  readExecutorModuleEas,
  readExecutorModuleIsInitialized,
  readSeedExecutorRouter,
} from './contracts'
import type { SeedTxRequest } from './seedSigner'

const MSG_LEGACY_ROUTER =
  'This ManagedAccount predates the Seed executor router extension, so the Seed executor cannot act for it and publish automation is not available for this account.'
const MSG_NOT_INITIALIZED =
  'The Seed executor is not installed for this ManagedAccount, so automation session keys cannot publish through it. The account admin installs it (installSeedExecutor), which enrollPublishAutomation does.'
const MSG_EAS_MISMATCH =
  'The Seed executor module is configured with a different EAS contract for this ManagedAccount than publish config. Automation session keys cannot change it.'
const MSG_READ_FAILED = 'Could not read the Seed executor module state for this ManagedAccount.'

function requireModuleAddress(): Address {
  const module = getPublishConfig().modularAccountModuleContract?.trim()
  if (!module || !/^0x[0-9a-fA-F]{40}$/.test(module)) {
    throw new Error(
      '@seedprotocol/publish: publish automation requires PublishConfig.modularAccountModuleContract (executor module).',
    )
  }
  return module as Address
}

/**
 * True for a Router account without the `SeedExecutorRouterExtension`: it cannot run the
 * executor at all, as opposed to an account where the executor is just not installed yet.
 */
async function lacksExecutorRouterExtension(managedAddress: Address): Promise<boolean> {
  return (await readSeedExecutorRouter(managedAddress)) === null
}

/**
 * Checks that the executor module can act for `managedAddress`: the module is initialized for
 * the account and points at the configured EAS. Checks what the module reports rather than the
 * account type, so any account the module has been set up for passes.
 *
 * @throws ManagedAccountPublishError `AUTOMATION_UNSUPPORTED_ACCOUNT` when it cannot
 */
export async function assertExecutorModuleReadyForAccount(managedAddress: string): Promise<void> {
  const module = requireModuleAddress()
  const account = managedAddress as Address

  let initialized: boolean
  let moduleEas: Address
  try {
    initialized = await readExecutorModuleIsInitialized(module, account)
    moduleEas = initialized ? await readExecutorModuleEas(module, account) : zeroAddress
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_READ_FAILED,
      'AUTOMATION_UNSUPPORTED_ACCOUNT',
      managedAddress,
      cause,
    )
  }

  if (!initialized) {
    const message = (await lacksExecutorRouterExtension(account)) ? MSG_LEGACY_ROUTER : MSG_NOT_INITIALIZED
    throw new ManagedAccountPublishError(message, 'AUTOMATION_UNSUPPORTED_ACCOUNT', managedAddress)
  }

  const expected = getPublishConfig().easContractAddress?.toLowerCase()
  if (expected && moduleEas.toLowerCase() !== expected) {
    throw new ManagedAccountPublishError(MSG_EAS_MISMATCH, 'AUTOMATION_UNSUPPORTED_ACCOUNT', managedAddress)
  }
}

function findRevertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined
  const withData = err.walk((e) => {
    const data = (e as { data?: unknown }).data
    return typeof data === 'string' && data.startsWith('0x') && data.length > 2
  }) as { data?: Hex } | null
  return withData?.data
}

function isRevert(err: unknown): boolean {
  if (findRevertData(err)) return true
  const msg = err instanceof BaseError ? `${err.shortMessage} ${err.details}` : String(err)
  return /revert/i.test(msg)
}

function describeRevert(data: Hex | undefined): string {
  if (!data) {
    return 'reverted with no data. The target likely has no matching function or the account cannot run executor calls'
  }
  try {
    const decoded = decodeErrorResult({ abi: [...executorModuleAbi, ...easAbi], data })
    const args = decoded.args?.length ? `(${decoded.args.map(String).join(', ')})` : ''
    return `reverted with ${decoded.errorName}${args}`
  } catch {
    return `reverted with data ${data}`
  }
}

/** True when a call failed because the caller can't cover gas fees, not because it reverted. */
function isInsufficientFunds(err: unknown): boolean {
  const msg = err instanceof BaseError ? `${err.shortMessage} ${err.details} ${err.message}` : String(err)
  return /insufficient funds|insufficient balance/i.test(msg)
}

/**
 * Simulates `tx` as a call from `managedAddress` (the call the account makes when it executes a
 * UserOp) and throws before anything is sent if it would revert. Also throws when the
 * simulation itself cannot run, so automation never submits a UserOp it could not check.
 *
 * @throws ManagedAccountPublishError `AUTOMATION_PREFLIGHT_FAILED`
 */
export async function simulateCallFromAccount(params: {
  managedAddress: string
  tx: SeedTxRequest
  /** Short description for the error message, e.g. "multiPublish via the executor module". */
  action: string
}): Promise<void> {
  const { managedAddress, tx, action } = params
  const call = (withBalance: boolean) =>
    getPublishPublicClient().call({
      account: managedAddress as Address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      // OP chains charge the L1 data fee up front, so an eth_call from an unfunded account
      // fails before running. A balance override lets the simulation reach the contract.
      ...(withBalance
        ? { stateOverride: [{ address: managedAddress as Address, balance: parseEther('1000') }] }
        : {}),
    })
  try {
    try {
      await call(false)
    } catch (err) {
      if (!isInsufficientFunds(err)) throw err
      await call(true)
    }
  } catch (cause) {
    const reason = isRevert(cause)
      ? describeRevert(findRevertData(cause))
      : 'could not be simulated'
    throw new ManagedAccountPublishError(
      `Simulated ${action} from ${managedAddress} ${reason}; nothing was sent.`,
      'AUTOMATION_PREFLIGHT_FAILED',
      managedAddress,
      cause,
    )
  }
}

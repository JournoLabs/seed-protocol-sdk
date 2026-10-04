import { BaseError, parseEther, zeroAddress, type Address } from 'viem'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError, type ManagedAccountPublishErrorCode } from '../errors'
import { getPublishPublicClient, readUntil } from './chainClient'
import {
  readExecutorModuleEas,
  readExecutorModuleIsInitialized,
  readSeedExecutorRouter,
} from './contracts'
import { describeRevert, findRevertData, isRevert } from './describeRevert'
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

export type ExecutorModuleReadinessOptions = {
  /**
   * The EAS the executor was just initialized with for the account, confirmed from the install
   * receipt (`ensureExecutorModuleInstalled`). When set, the module state is not re-read: right
   * after the install, a lagging RPC node can still report it uninitialized.
   */
  installedEas?: Address
  /**
   * Times to read `isInitialized` before reporting the module uninitialized, 2s apart. Default 1.
   * Use more right after an install that a lagging RPC node may not have seen yet.
   */
  readAttempts?: number
}

/**
 * Checks that the executor module can act for `managedAddress`: the module is initialized for
 * the account and points at the configured EAS. Checks what the module reports rather than the
 * account type, so any account the module has been set up for passes.
 *
 * @throws ManagedAccountPublishError `AUTOMATION_UNSUPPORTED_ACCOUNT` when it cannot
 */
export async function assertExecutorModuleReadyForAccount(
  managedAddress: string,
  options: ExecutorModuleReadinessOptions = {},
): Promise<void> {
  const module = requireModuleAddress()
  const account = managedAddress as Address

  let initialized: boolean
  let moduleEas: Address
  if (options.installedEas) {
    initialized = true
    moduleEas = options.installedEas
  } else {
    try {
      initialized = await readUntil(
        () => readExecutorModuleIsInitialized(module, account),
        Boolean,
        { attempts: options.readAttempts ?? 1 },
      )
      moduleEas = initialized ? await readExecutorModuleEas(module, account) : zeroAddress
    } catch (cause) {
      throw new ManagedAccountPublishError(
        MSG_READ_FAILED,
        'AUTOMATION_UNSUPPORTED_ACCOUNT',
        managedAddress,
        cause,
      )
    }
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

/** True when a call failed because the caller can't cover gas fees, not because it reverted. */
function isInsufficientFunds(err: unknown): boolean {
  const msg = err instanceof BaseError ? `${err.shortMessage} ${err.details} ${err.message}` : String(err)
  return /insufficient funds|insufficient balance/i.test(msg)
}

/**
 * Simulates `tx` as a call from `managedAddress` (the call the account makes when it executes a
 * UserOp) and throws before anything is sent if it would revert. By default also throws when
 * the simulation itself cannot run, so automation never submits a UserOp it could not check.
 *
 * @throws ManagedAccountPublishError `code` (default `AUTOMATION_PREFLIGHT_FAILED`)
 */
export async function simulateCallFromAccount(params: {
  /** The account that sends `tx`. */
  managedAddress: string
  tx: SeedTxRequest
  /** Short description for the error message, e.g. "multiPublish via the executor module". */
  action: string
  code?: ManagedAccountPublishErrorCode
  /** False to let the send go ahead when the simulation cannot run (only a revert throws). */
  requireSimulation?: boolean
}): Promise<void> {
  const { managedAddress, tx, action, code = 'AUTOMATION_PREFLIGHT_FAILED', requireSimulation = true } = params
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
    const reverted = isRevert(cause)
    if (!reverted && !requireSimulation) return
    const reason = reverted ? describeRevert(findRevertData(cause)) : 'could not be simulated'
    throw new ManagedAccountPublishError(
      `Simulated ${action} from ${managedAddress} ${reason}; nothing was sent.`,
      code,
      managedAddress,
      cause,
    )
  }
}

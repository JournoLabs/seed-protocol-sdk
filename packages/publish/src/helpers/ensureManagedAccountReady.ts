import { optimismSepolia } from 'thirdweb/chains'
import {
  deploySmartWalletContract,
  getClient,
  getConnectedManagedAccountAddress,
  getManagedAccountWallet,
  isSmartWalletDeployed,
} from './thirdweb'
import { getPublishConfig } from '../config'
import { isManagedAccountPublishError, ManagedAccountPublishError } from '../errors'
import { ensureExecutorModuleInstalled } from './ensureExecutorModule'

const MSG_UNAVAILABLE =
  'Could not connect the managed publishing account on Optimism Sepolia. Reconnect with the same sign-in method and try again.'

const MSG_NOT_DEPLOYED =
  'Your publishing smart account is not deployed on Optimism Sepolia yet. Complete wallet setup, enable autoDeployManagedAccount in config if appropriate, then try again.'

const MSG_NOT_DEPLOYED_AFTER_ATTEMPT =
  'The managed account could not be confirmed on Optimism Sepolia after deployment. Wait a moment and retry, or check your network connection.'

const MSG_FAILED_DEPLOY =
  'Automatic deployment of the managed publishing account failed on Optimism Sepolia. Retry or deploy the account through your wallet provider.'

export type EnsureManagedAccountReadyResult =
  | { kind: 'skip' }
  | { kind: 'unavailable'; cause: unknown }
  | { kind: 'not_deployed'; managedAddress: string }
  | { kind: 'ready'; managedAddress: string }

/**
 * Checks managed account deployment for the modular executor path.
 * Returns `{ kind: 'skip' }` when `useModularExecutor` is false.
 */
export async function ensureManagedAccountReady(): Promise<EnsureManagedAccountReadyResult> {
  const { useModularExecutor } = getPublishConfig()
  if (!useModularExecutor) {
    return { kind: 'skip' }
  }

  let managedAddress: string
  try {
    managedAddress = await getConnectedManagedAccountAddress(optimismSepolia)
  } catch (cause) {
    return { kind: 'unavailable', cause }
  }

  const deployed = await isSmartWalletDeployed(managedAddress)
  if (deployed) {
    return { kind: 'ready', managedAddress }
  }
  return { kind: 'not_deployed', managedAddress }
}

async function getManagedAccountSigningAccount() {
  const managedWallet = getManagedAccountWallet()
  await managedWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
  const acc = managedWallet.getAccount()
  if (!acc) {
    throw new ManagedAccountPublishError(MSG_UNAVAILABLE, 'MANAGED_ACCOUNT_UNAVAILABLE')
  }
  return acc
}

/**
 * Deploys the ManagedAccount via the factory using the managed in-app wallet signer.
 * @throws ManagedAccountPublishError on missing account or deploy failure
 */
export async function tryDeployManagedAccount(): Promise<void> {
  const account = await getManagedAccountSigningAccount()
  try {
    await deploySmartWalletContract(account)
  } catch (cause) {
    throw new ManagedAccountPublishError(MSG_FAILED_DEPLOY, 'MANAGED_ACCOUNT_NOT_DEPLOYED', account.address, cause)
  }
}

export type ModularExecutorPublishPrepResult =
  | { ok: true; managedAddress: string }
  | { ok: false; error: ManagedAccountPublishError }

/**
 * Full gate for modular executor publish: deployment check, optional factory deploy, optional executor module on the managed contract.
 * Call only when `useModularExecutor` is true.
 */
export async function runModularExecutorPublishPrep(): Promise<ModularExecutorPublishPrepResult> {
  const config = getPublishConfig()
  if (!config.useModularExecutor) {
    throw new Error('runModularExecutorPublishPrep: useModularExecutor is false')
  }

  let state = await ensureManagedAccountReady()

  if (state.kind === 'unavailable') {
    return {
      ok: false,
      error: new ManagedAccountPublishError(MSG_UNAVAILABLE, 'MANAGED_ACCOUNT_UNAVAILABLE', undefined, state.cause),
    }
  }

  if (state.kind === 'not_deployed') {
    if (config.autoDeployManagedAccount) {
      try {
        await tryDeployManagedAccount()
      } catch (e) {
        const err =
          isManagedAccountPublishError(e)
            ? e
            : new ManagedAccountPublishError(MSG_FAILED_DEPLOY, 'MANAGED_ACCOUNT_NOT_DEPLOYED', state.managedAddress, e)
        return { ok: false, error: err }
      }
      state = await ensureManagedAccountReady()
      if (state.kind !== 'ready') {
        return {
          ok: false,
          error: new ManagedAccountPublishError(
            MSG_NOT_DEPLOYED_AFTER_ATTEMPT,
            'MANAGED_ACCOUNT_NOT_DEPLOYED',
            state.kind === 'not_deployed' ? state.managedAddress : undefined,
          ),
        }
      }
    } else {
      return {
        ok: false,
        error: new ManagedAccountPublishError(MSG_NOT_DEPLOYED, 'MANAGED_ACCOUNT_NOT_DEPLOYED', state.managedAddress),
      }
    }
  }

  if (state.kind === 'ready') {
    if (config.modularAccountModuleContract) {
      try {
        const signingAccount = await getManagedAccountSigningAccount()
        await ensureExecutorModuleInstalled(state.managedAddress, signingAccount, config)
      } catch (e) {
        if (isManagedAccountPublishError(e)) {
          return { ok: false, error: e }
        }
        return {
          ok: false,
          error: new ManagedAccountPublishError(
            'Executor module setup failed on Optimism Sepolia.',
            'EXECUTOR_MODULE_NOT_INSTALLED',
            state.managedAddress,
            e,
          ),
        }
      }
    }
    return { ok: true, managedAddress: state.managedAddress }
  }

  throw new Error('runModularExecutorPublishPrep: unexpected readiness state')
}

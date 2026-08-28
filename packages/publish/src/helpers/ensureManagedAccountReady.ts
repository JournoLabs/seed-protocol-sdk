import { optimismSepolia } from 'thirdweb/chains'
import {
  deploySmartWalletContract,
  getClient,
  getConnectedModularAccount,
  getConnectedManagedAccountAddress,
  getManagedAccountWallet,
  getModularAccountWallet,
  deployManagedAccountViaFactory,
  isSmartWalletDeployed,
  pollSmartWalletDeployed,
  syncPublishInAppAuthToken,
} from './thirdweb'
import { getPublishConfig } from '../config'
import { isManagedAccountPublishError, ManagedAccountPublishError, stringifyUnderlyingCause } from '../errors'
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
  syncPublishInAppAuthToken()
  const managedWallet = getManagedAccountWallet()
  await managedWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
  const acc = managedWallet.getAccount()
  if (!acc) {
    throw new ManagedAccountPublishError(MSG_UNAVAILABLE, 'MANAGED_ACCOUNT_UNAVAILABLE')
  }
  return acc
}

const DEPLOY_TIMEOUT_MS = 90_000

async function deploySmartWalletWithTimeout(account: import('thirdweb/wallets').Account): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      deploySmartWalletContract(account),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Managed account deploy timed out after ${DEPLOY_TIMEOUT_MS / 1000}s`)),
          DEPLOY_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId)
  }
}

/**
 * Deploys the ManagedAccount via the factory using the managed in-app wallet signer,
 * or {@link PublishConfig.deployManagedAccount} when the host app provides a custom deploy path.
 * @throws ManagedAccountPublishError on missing account or deploy failure
 */
export async function tryDeployManagedAccount(managedAddress: string): Promise<void> {
  const config = getPublishConfig()
  const account = await getManagedAccountSigningAccount()
  const { fromThirdwebAccount } = await import('./adapters/thirdwebAccount')
  const managedSigningAccount = fromThirdwebAccount(account)

  const deployParams = { managedAddress, managedSigningAccount }

  try {
    if (config.deployManagedAccount) {
      await config.deployManagedAccount(deployParams)
    } else {
      const modularAccount = await getConnectedModularAccount()
      if (modularAccount) {
        const modularWallet = getModularAccountWallet()
        await modularWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
        const adminAddress =
          modularWallet.getAdminAccount?.()?.address ?? modularAccount.address
        await deployManagedAccountViaFactory({
          adminAddress,
          signingAccount: modularAccount,
        })
      } else {
        await deploySmartWalletWithTimeout(account)
      }
    }
  } catch (cause) {
    const isUserOpTimeout = /UserOp|user operation/i.test(stringifyUnderlyingCause(cause))
    const pollAttempts = isUserOpTimeout ? 15 : 5
    if (await pollSmartWalletDeployed(managedAddress, pollAttempts)) {
      return
    }
    throw new ManagedAccountPublishError(MSG_FAILED_DEPLOY, 'MANAGED_ACCOUNT_NOT_DEPLOYED', managedAddress, cause)
  }

  if (!(await pollSmartWalletDeployed(managedAddress))) {
    throw new ManagedAccountPublishError(
      MSG_NOT_DEPLOYED_AFTER_ATTEMPT,
      'MANAGED_ACCOUNT_NOT_DEPLOYED',
      managedAddress,
    )
  }
}

export type ModularExecutorPublishPrepResult =
  | { ok: true; managedAddress: string }
  | { ok: false; error: ManagedAccountPublishError }

/**
 * Full gate for modular executor publish: managed-account deployment check, optional factory deploy,
 * optional executor module on the managed contract. EIP-7702 modular wallet readiness is handled separately
 * in {@link ensureEip7702ModularAccountReady}.
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
        await tryDeployManagedAccount(state.managedAddress)
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

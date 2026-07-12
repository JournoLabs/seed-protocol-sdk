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

  // #region agent log
  fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:deploy-start',message:'tryDeployManagedAccount starting',data:{managedAddress,accountAddress:account.address,usesCustomDeploy:Boolean(config.deployManagedAccount)},timestamp:Date.now(),hypothesisId:'H2',runId:'post-fix-v3'})}).catch(()=>{});
  // #endregion

  const deployParams = { managedAddress, managedSigningAccount: account }

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
      // #region agent log
      fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:deploy-recovered',message:'deploy threw but bytecode appeared after poll',data:{managedAddress,error:cause instanceof Error?cause.message:String(cause)},timestamp:Date.now(),hypothesisId:'H2',runId:'post-fix-v3'})}).catch(()=>{});
      // #endregion
      return
    }
    // #region agent log
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:deploy-failed',message:'tryDeployManagedAccount failed',data:{managedAddress,error:cause instanceof Error?cause.message:String(cause)},timestamp:Date.now(),hypothesisId:'H2',runId:'post-fix-v3'})}).catch(()=>{});
    // #endregion
    throw new ManagedAccountPublishError(MSG_FAILED_DEPLOY, 'MANAGED_ACCOUNT_NOT_DEPLOYED', managedAddress, cause)
  }

  if (!(await pollSmartWalletDeployed(managedAddress))) {
    // #region agent log
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:deploy-not-confirmed',message:'deploy finished but bytecode still empty',data:{managedAddress},timestamp:Date.now(),hypothesisId:'H2',runId:'post-fix-v3'})}).catch(()=>{});
    // #endregion
    throw new ManagedAccountPublishError(
      MSG_NOT_DEPLOYED_AFTER_ATTEMPT,
      'MANAGED_ACCOUNT_NOT_DEPLOYED',
      managedAddress,
    )
  }

  // #region agent log
  fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:deploy-success',message:'managed account deploy loader confirmed on chain',data:{managedAddress},timestamp:Date.now(),hypothesisId:'H2',runId:'post-fix-v3'})}).catch(()=>{});
  // #endregion
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
  // #region agent log
  fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:prep-start',message:'runModularExecutorPublishPrep initial state',data:{stateKind:state.kind,managedAddress:state.kind!=='skip'&&state.kind!=='unavailable'?state.managedAddress:undefined,autoDeployManagedAccount:config.autoDeployManagedAccount},timestamp:Date.now(),hypothesisId:'H2',runId:'publish-debug'})}).catch(()=>{});
  // #endregion

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
        // #region agent log
        fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:deploy-failed',message:'tryDeployManagedAccount failed',data:{error:e instanceof Error?e.message:String(e)},timestamp:Date.now(),hypothesisId:'H2',runId:'publish-debug'})}).catch(()=>{});
        // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:module-install-failed',message:'executor module install failed at publish prep',data:{managedAddress:state.managedAddress,error:e instanceof Error?e.message:String(e),code:isManagedAccountPublishError(e)?e.code:undefined},timestamp:Date.now(),hypothesisId:'H1',runId:'publish-debug'})}).catch(()=>{});
        // #endregion
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

    // #region agent log
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:prep-done',message:'runModularExecutorPublishPrep complete',data:{ok:true,managedAddress:state.managedAddress},timestamp:Date.now(),hypothesisId:'H1,H2',runId:'post-fix-v2'})}).catch(()=>{});
    // #endregion
    return { ok: true, managedAddress: state.managedAddress }
  }

  // #region agent log
  fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureManagedAccountReady.ts:prep-unexpected',message:'unexpected prep state',data:{stateKind:state.kind},timestamp:Date.now(),hypothesisId:'H2',runId:'publish-debug'})}).catch(()=>{});
  // #endregion
  throw new Error('runModularExecutorPublishPrep: unexpected readiness state')
}

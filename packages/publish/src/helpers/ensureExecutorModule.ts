import { getContract, sendTransaction, waitForReceipt } from 'thirdweb'
import { getInstalledModules, installModule } from 'thirdweb/modules'
import { optimismSepolia } from 'thirdweb/chains'
import type { Account } from 'thirdweb/wallets'
import { encodeAbiParameters } from 'viem'
import { getClient, isSmartWalletDeployed } from './thirdweb'
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
 * No-op if `modularAccountModuleContract` is unset, or if `contractAddress` has no bytecode yet
 * (counterfactual managed account before factory deploy — publish prep installs the module later).
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

  // #region agent log
  const deployed = await isSmartWalletDeployed(contractAddress)
  fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureExecutorModule.ts:entry',message:'ensureExecutorModuleInstalled entry',data:{contractAddress,modularAccountModuleContract,deployed},timestamp:Date.now(),hypothesisId:'A,B',runId:'post-fix'})}).catch(()=>{});
  // #endregion

  if (!deployed) {
    // #region agent log
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureExecutorModule.ts:skip-not-deployed',message:'skip module install — account not deployed yet',data:{contractAddress},timestamp:Date.now(),hypothesisId:'A',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    return
  }

  let step = 'getInstalledModules'
  try {
    const installed = await getInstalledModules({ contract: accountContract })
    // #region agent log
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureExecutorModule.ts:getInstalledModules',message:'getInstalledModules ok',data:{contractAddress,installedCount:installed.length,implementations:installed.map((m:{implementation:string})=>m.implementation?.toLowerCase())},timestamp:Date.now(),hypothesisId:'B',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    const moduleAddr = modularAccountModuleContract.toLowerCase()
    const isInstalled = installed.some(
      (m: { implementation: string }) => m.implementation?.toLowerCase() === moduleAddr,
    )
    if (isInstalled) return

    step = 'installModule'
    const tx = installModule({
      contract: accountContract,
      moduleContract: modularAccountModuleContract,
      data: encodeAbiParameters([{ type: 'address' }], [EAS_CONTRACT_ADDRESS]),
    })
    step = 'sendTransaction'
    const result = await sendTransaction({ transaction: tx, account })
    step = 'waitForReceipt'
    await waitForReceipt({
      client: getClient(),
      transactionHash: result.transactionHash,
      chain: optimismSepolia,
    })
  } catch (cause) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause)
    const isRouterErr = isRouterNonModularCoreAccountError(cause)
    // #region agent log
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureExecutorModule.ts:catch',message:'ensureExecutorModuleInstalled failed',data:{contractAddress,step,causeMsg,isRouterErr,deployed},timestamp:Date.now(),hypothesisId:'A,B,C,D,E',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    if (isRouterErr) {
      // #region agent log
      fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureExecutorModule.ts:skip-non-modular',message:'skip module install — account is not ModularCore',data:{contractAddress,step,causeMsg},timestamp:Date.now(),hypothesisId:'H1',runId:'post-fix-v2'})}).catch(()=>{});
      // #endregion
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

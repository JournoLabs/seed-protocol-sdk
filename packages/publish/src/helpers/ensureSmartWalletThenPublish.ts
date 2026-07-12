import type { Account } from 'thirdweb/wallets'
import type { Item } from '@seedprotocol/sdk'
import { optimismSepolia } from 'thirdweb/chains'
import {
  getConnectedManagedAccountAddress,
  getConnectedModularAccount,
  resolveSmartWalletForPublish,
} from './thirdweb'
import { PublishManager } from '../services/publishManager'
import type { CreatePublishOptions } from '../config'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'

export type EnsureSmartWalletResult =
  | { outcome: 'started' }
  | { outcome: 'no_address' }
  | { outcome: 'needs_deploy' }
  | { outcome: 'managed_not_ready'; error: ManagedAccountPublishError }

const MSG_NO_ACCOUNT_MODULAR =
  'A connected wallet is required for publishing with the modular executor. Connect your wallet and try again.'

const MSG_MANAGED_UNAVAILABLE =
  'Could not connect the managed publishing account on Optimism Sepolia. Reconnect with the same sign-in method and try again.'

/**
 * Resolves the smart wallet for the current account; if deployed, starts publish.
 * If the user has no deployed ManagedAccount (non-modular path), returns needs_deploy so the caller can open the deploy modal.
 *
 * When **`useModularExecutor`** is true:
 * - Spawns the publish machine immediately using the counterfactual
 *   **ManagedAccount** address and the **modular EIP-7702** signing account.
 * - Managed-account deploy, module install, session signer, and EIP-7702 readiness run later in
 *   `createAttestations` via {@link runModularExecutorPublishPrep} and {@link ensureModularPublishBootstrap}.
 * The **`activeAccount`** argument is ignored on this path (kept for API compatibility with call sites).
 *
 * Pass `options.publishMode`: `patch` (default) publishes only pending properties on the current Version;
 * `new_version` creates a new Version attestation and re-attests all properties (requires an existing Seed UID).
 */
export async function ensureSmartWalletThenPublish(
  item: Item<any>,
  activeAccount: Account | null | undefined,
  getAddress: () => Promise<string | null>,
  options?: CreatePublishOptions,
): Promise<EnsureSmartWalletResult> {
  const config = getPublishConfig()
  const address = await getAddress()
  if (!address || !address.trim()) {
    return { outcome: 'no_address' }
  }

  if (config.useModularExecutor) {
    const modularAccount = await getConnectedModularAccount()
    if (!modularAccount) {
      // #region agent log
      fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureSmartWalletThenPublish.ts:no-modular',message:'getConnectedModularAccount returned null',data:{},timestamp:Date.now(),hypothesisId:'H2',runId:'publish-debug'})}).catch(()=>{});
      // #endregion
      return {
        outcome: 'managed_not_ready',
        error: new ManagedAccountPublishError(MSG_NO_ACCOUNT_MODULAR, 'MANAGED_ACCOUNT_UNAVAILABLE'),
      }
    }

    let managedAddress: string
    try {
      managedAddress = await getConnectedManagedAccountAddress(optimismSepolia)
    } catch (cause) {
      return {
        outcome: 'managed_not_ready',
        error: new ManagedAccountPublishError(
          MSG_MANAGED_UNAVAILABLE,
          'MANAGED_ACCOUNT_UNAVAILABLE',
          undefined,
          cause,
        ),
      }
    }

    // #region agent log
    fetch('http://127.0.0.1:7754/ingest/2810478a-7cf0-49a8-bc23-760b81417972',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a35748'},body:JSON.stringify({sessionId:'a35748',location:'ensureSmartWalletThenPublish.ts:createPublish',message:'calling createPublish (prep deferred to createAttestations)',data:{managedAddress,modularAddress:modularAccount.address,itemSeedLocalId:item.seedLocalId},timestamp:Date.now(),hypothesisId:'H5',runId:'post-fix-v4'})}).catch(()=>{});
    // #endregion
    PublishManager.createPublish(item, managedAddress, modularAccount, {
      dataItemSigner: modularAccount,
      ...options,
    })
    return { outcome: 'started' }
  }

  const resolved = await resolveSmartWalletForPublish(activeAccount ?? null)
  if ('address' in resolved) {
    PublishManager.createPublish(item, resolved.address, resolved.account, {
      dataItemSigner: resolved.account,
      ...options,
    })
    return { outcome: 'started' }
  }
  return { outcome: 'needs_deploy' }
}

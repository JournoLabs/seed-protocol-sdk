import type { Account } from 'thirdweb/wallets'
import { optimismSepolia } from 'thirdweb/chains'
import { getPublishConfig } from '../config'
import { isManagedAccountPublishError } from '../errors'
import { ensureEip7702ModularAccountReady } from './ensureEip7702ModularAccountReady'
import { ensureManagedAccountEasConfigured } from './ensureManagedAccountEasConfigured'
import { ensureManagedSignerSessionKey } from './ensureManagedSignerSessionKey'
import { getClient, getModularAccountWallet } from './thirdweb'

/**
 * One-time modular publish bootstrap before `multiPublish`:
 * session signer on managed account → EAS pointer → optional EIP-7702 fallback.
 */
export async function ensureModularPublishBootstrap(managedAddress: string): Promise<Account> {
  const modularAccountWallet = getModularAccountWallet()
  await modularAccountWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
  const modularAccount = modularAccountWallet.getAccount()
  if (!modularAccount) {
    throw new Error('Failed to get modular account')
  }

  try {
    await ensureManagedSignerSessionKey({
      managedAddress,
      signerAddress: modularAccount.address,
    })
  } catch (cause) {
    if (!getPublishConfig().autoDeployEip7702ModularAccount) {
      throw cause
    }
    if (!isManagedAccountPublishError(cause)) {
      throw cause
    }
    await ensureEip7702ModularAccountReady()
  }

  await ensureManagedAccountEasConfigured(managedAddress, modularAccount)
  return modularAccount
}

import type { Account } from 'thirdweb/wallets'
import { ManagedAccountPublishError } from '../errors'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'
import { getPublishChainName } from './chainConfig'
import { ensureManagedAccountEasConfigured } from './ensureManagedAccountEasConfigured'
import { getManagedAccountAdmin } from './managedAccountAdmin'
import { getClient, getManagedAccountWallet, syncPublishInAppAuthToken } from './thirdweb'
import { getPublishThirdwebChain } from './thirdwebChain'

/**
 * Returns the account that sends interactive `multiPublish`: the user's managed (EIP-4337) smart
 * account. Its UserOps execute `multiPublish` on the account itself, a self-call the Seed
 * extension accepts; session keys and other non-admin callers are rejected with `Unauthorized`.
 *
 * Also checks the account's EAS pointer. Only pre-rollout accounts that report no EAS get
 * `setEas`, sent by the admin EOA.
 */
export async function ensureModularPublishBootstrap(managedAddress: string): Promise<Account> {
  syncPublishInAppAuthToken()
  const managedWallet = getManagedAccountWallet()
  await managedWallet.autoConnect({ client: getClient(), chain: getPublishThirdwebChain() })
  const managedAccount = managedWallet.getAccount()
  if (!managedAccount) {
    throw new ManagedAccountPublishError(
      `Could not connect the managed publishing account on ${getPublishChainName()}. Reconnect with the same sign-in method and try again.`,
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
    )
  }
  if (managedAccount.address.toLowerCase() !== managedAddress.toLowerCase()) {
    throw new ManagedAccountPublishError(
      `The connected managed account (${managedAccount.address}) is not the publishing account ${managedAddress}. Reconnect with the sign-in method that owns it.`,
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
    )
  }

  await ensureManagedAccountEasConfigured(managedAddress, async () =>
    fromThirdwebAccount(await getManagedAccountAdmin(managedAddress)),
  )
  return managedAccount
}

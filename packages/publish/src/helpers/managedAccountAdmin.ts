import type { Address } from 'viem'
import type { Account } from 'thirdweb/wallets'
import { ManagedAccountPublishError } from '../errors'
import { getPublishChainName } from './chainConfig'
import { readIsAdmin } from './contracts'
import { getClient, getModularAccountWallet, syncPublishInAppAuthToken } from './thirdweb'
import { getPublishThirdwebChain } from './thirdwebChain'

/**
 * Connects the user's in-app EOA, the ManagedAccount's admin, for admin-only transactions such as
 * `installSeedExecutor`. Those must come from the admin directly: the new contracts reject them as
 * self-calls from the smart account. `PublishConfig.thirdweb.modularWalletMode` decides whether
 * the EOA sends gas-sponsored EIP-7702 transactions (default) or plain funded ones.
 *
 * @throws ManagedAccountPublishError `MANAGED_ACCOUNT_UNAVAILABLE` when the wallet is not
 * connected or is not an admin of `managedAddress`
 */
export async function getManagedAccountAdmin(managedAddress: string): Promise<Account> {
  syncPublishInAppAuthToken()
  const wallet = getModularAccountWallet()
  await wallet.autoConnect({ client: getClient(), chain: getPublishThirdwebChain() })
  const admin = wallet.getAccount()
  if (!admin) {
    throw new ManagedAccountPublishError(
      `Could not connect the in-app wallet that administers your publishing account on ${getPublishChainName()}. Reconnect with the same sign-in method and try again.`,
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
    )
  }
  let isAdmin: boolean
  try {
    isAdmin = await readIsAdmin(managedAddress as Address, admin.address as Address)
  } catch (cause) {
    throw new ManagedAccountPublishError(
      `Could not check the admins of your publishing account on ${getPublishChainName()}.`,
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
      cause,
    )
  }
  if (!isAdmin) {
    throw new ManagedAccountPublishError(
      `The connected in-app wallet (${admin.address}) is not an admin of publishing account ${managedAddress}.`,
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
    )
  }
  return admin
}

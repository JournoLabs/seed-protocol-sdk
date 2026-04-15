import type { Account } from 'thirdweb/wallets'
import { optimismSepolia } from 'thirdweb/chains'
import { getGetAdditionalSyncAddresses } from '@seedprotocol/sdk'
import {
  getClient,
  getSmartWalletAddressForAdmin,
  isSmartWalletDeployed,
  getManagedAccountWallet,
} from '~/helpers/thirdweb'

/**
 * Resolves which account to use for revoking attestations.
 * When the attester is the user's ManagedAccount (EIP4337) but they're connected
 * with a different wallet (e.g. EOA or modular account), attempts to use the
 * ManagedAccount wallet for the revoke.
 *
 * @param account - The currently connected account
 * @param attester - The attester address from the seed (publisher or attestationRaw.attester)
 * @returns The account to use for revoke
 * @throws If `attester` equals any address from {@link getGetAdditionalSyncAddresses}
 *   (e.g. `modularAccountModuleContract` when `initPublish` registers it). Those addresses
 *   cannot revoke via the app wallet’s EAS `multiRevoke` path today.
 */
export async function resolveRevokeAccount(params: {
  account: Account
  attester: string | null
}): Promise<Account> {
  const { account, attester } = params

  if (!attester || account.address.toLowerCase() === attester.toLowerCase()) {
    return account
  }

  const additionalGetter = getGetAdditionalSyncAddresses()
  if (additionalGetter) {
    const additional = await additionalGetter()
    const attesterLower = attester.toLowerCase()
    if (additional?.some((a: string | undefined) => a?.toLowerCase() === attesterLower)) {
      throw new Error(
        'Revocation not supported for items published via the modular executor.',
      )
    }
  }

  try {
    const derivedManagedAccount = await getSmartWalletAddressForAdmin(account.address)
    const attesterLower = attester.toLowerCase()
    const derivedLower = derivedManagedAccount.toLowerCase()

    if (attesterLower === derivedLower) {
      const deployed = await isSmartWalletDeployed(derivedManagedAccount)
      if (deployed) {
        const managedAccountWallet = getManagedAccountWallet()
        await managedAccountWallet.autoConnect({
          client: getClient(),
          chain: optimismSepolia,
        })
        const managedAccount = managedAccountWallet.getAccount()
        if (managedAccount) {
          return managedAccount
        }
      }
    }
  } catch {
    // Fall through to return account; revoke attempt may fail with AccessDenied
  }

  return account
}

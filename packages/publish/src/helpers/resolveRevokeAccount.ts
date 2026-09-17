import type { Account } from 'thirdweb/wallets'
import { optimismSepolia } from 'thirdweb/chains'
import { getGetAdditionalSyncAddresses } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import {
  getClient,
  getSmartWalletAddressForAdmin,
  isSmartWalletDeployed,
  getManagedAccountWallet,
  getConnectedManagedAccountAddress,
} from '~/helpers/thirdweb'

/**
 * Resolves which account to use for revoking attestations.
 * When the attester is the user's ManagedAccount (EIP4337) but they're connected
 * with a different wallet (e.g. EOA or modular account), attempts to use the
 * ManagedAccount wallet for the revoke.
 *
 * When the attester is the legacy executor module address, attempts the ManagedAccount
 * wallet if `modularAccountModuleContract` is configured (executor-routed multiRevoke).
 * Throws only when the module was the attester and no ManagedAccount path is available.
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
  let attesterIsExecutorModule = false
  if (additionalGetter) {
    const additional = await additionalGetter()
    const attesterLower = attester.toLowerCase()
    attesterIsExecutorModule = !!additional?.some(
      (a: string | undefined) => a?.toLowerCase() === attesterLower,
    )
  }

  try {
    const derivedManagedAccount = await getSmartWalletAddressForAdmin(account.address)
    const attesterLower = attester.toLowerCase()
    const derivedLower = derivedManagedAccount.toLowerCase()

    if (attesterLower === derivedLower || attesterIsExecutorModule) {
      const managedAddress = attesterIsExecutorModule
        ? await getConnectedManagedAccountAddress(optimismSepolia).catch(() => derivedManagedAccount)
        : derivedManagedAccount
      const deployed = await isSmartWalletDeployed(managedAddress)
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
    // Fall through
  }

  if (attesterIsExecutorModule) {
    const { modularAccountModuleContract } = getPublishConfig()
    if (!modularAccountModuleContract?.trim()) {
      throw new Error(
        'Revocation not supported for items published via the modular executor.',
      )
    }
    // Module configured but ManagedAccount wallet unavailable
    throw new Error(
      'Revocation not supported for items published via the modular executor. Connect the ManagedAccount that controls the executor module.',
    )
  }

  return account
}

import { ManagedAccountPublishError } from '../errors'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'
import {
  ensureAutomationSessionKey as ensureAutomationSessionKeyCore,
  removeAutomationSessionKey as removeAutomationSessionKeyCore,
} from './ensureAutomationSessionKey'
import type { PublishWallet } from './seedSigner'
import { getClient, getManagedAccountWallet } from './thirdweb'
import { getPublishThirdwebChain } from './thirdwebChain'

/**
 * The connected managed in-app wallet as a `PublishWallet`. Its signer signs a session-key grant
 * with the admin EOA (thirdweb signs typed data addressed to the account itself that way), and its
 * sender sends a sponsored UserOp from the account.
 *
 * @throws ManagedAccountPublishError `MANAGED_ACCOUNT_UNAVAILABLE` when no wallet is connected
 */
export async function connectManagedAccountWallet(managedAddress: string): Promise<PublishWallet> {
  const managedWallet = getManagedAccountWallet()
  await managedWallet.autoConnect({ client: getClient(), chain: getPublishThirdwebChain() })
  const account = managedWallet.getAccount()
  if (!account) {
    throw new ManagedAccountPublishError(
      'Could not connect the managed publishing account. Reconnect and try again.',
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
    )
  }
  return fromThirdwebAccount(account, { kind: 'smart' })
}

/** {@link ensureAutomationSessionKeyCore} with `admin` defaulting to the connected managed in-app wallet. */
export async function ensureAutomationSessionKey(params: {
  managedAddress: string
  sessionKeyAddress: string
  expiresAt?: number
  admin?: PublishWallet
}): Promise<void> {
  const admin = params.admin ?? (await connectManagedAccountWallet(params.managedAddress))
  await ensureAutomationSessionKeyCore({ ...params, admin })
}

/** {@link removeAutomationSessionKeyCore} with `admin` defaulting to the connected managed in-app wallet. */
export async function removeAutomationSessionKey(params: {
  managedAddress: string
  sessionKeyAddress: string
  admin?: PublishWallet
}): Promise<void> {
  const admin = params.admin ?? (await connectManagedAccountWallet(params.managedAddress))
  await removeAutomationSessionKeyCore({ ...params, admin })
}

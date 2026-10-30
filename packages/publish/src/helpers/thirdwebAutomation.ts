import { ManagedAccountPublishError } from '../errors'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'
import type { PublishConfig } from '../config'
import {
  ensureExecutorModuleInstalled as ensureExecutorModuleInstalledCore,
  type EnsureExecutorModuleResult,
} from './ensureExecutorModule'
import {
  ensureAutomationSessionKey as ensureAutomationSessionKeyCore,
  removeAutomationSessionKey as removeAutomationSessionKeyCore,
} from './ensureAutomationSessionKey'
import {
  enrollPublishAutomation as enrollPublishAutomationCore,
  revokePublishAutomation as revokePublishAutomationCore,
  type EnrollPublishAutomationParams as CoreEnrollParams,
  type EnrollPublishAutomationResult,
  type RevokePublishAutomationParams as CoreRevokeParams,
} from './enrollPublishAutomation'
import { getManagedAccountAdminWallet } from './managedAccountAdmin'
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

export type EnrollPublishAutomationParams = Omit<CoreEnrollParams, 'userWallet'> & {
  /** Defaults to the connected managed in-app wallet. */
  userWallet?: PublishWallet
}

export type RevokePublishAutomationParams = Omit<CoreRevokeParams, 'userWallet'> & {
  /** Defaults to the connected managed in-app wallet. */
  userWallet?: PublishWallet
}

/**
 * {@link enrollPublishAutomationCore} with `userWallet` defaulting to the connected managed in-app
 * wallet and `admin` to its in-app admin EOA.
 */
export async function enrollPublishAutomation(
  params: EnrollPublishAutomationParams,
): Promise<EnrollPublishAutomationResult> {
  const userWallet = params.userWallet ?? (await connectManagedAccountWallet(params.managedAddress))
  const admin = params.admin ?? (await getManagedAccountAdminWallet(params.managedAddress))
  return enrollPublishAutomationCore({ ...params, userWallet, admin })
}

/** {@link revokePublishAutomationCore} with `userWallet` defaulting to the connected managed in-app wallet. */
export async function revokePublishAutomation(params: RevokePublishAutomationParams): Promise<void> {
  const userWallet = params.userWallet ?? (await connectManagedAccountWallet(params.managedAddress))
  await revokePublishAutomationCore({ ...params, userWallet })
}

/** {@link ensureExecutorModuleInstalledCore} with `getAdmin` defaulting to the connected in-app admin EOA. */
export async function ensureExecutorModuleInstalled(
  contractAddress: string,
  getAdmin: (() => Promise<PublishWallet>) | undefined,
  config: Pick<PublishConfig, 'modularAccountModuleContract'>,
): Promise<EnsureExecutorModuleResult> {
  return ensureExecutorModuleInstalledCore(
    contractAddress,
    getAdmin ?? (() => getManagedAccountAdminWallet(contractAddress)),
    config,
  )
}

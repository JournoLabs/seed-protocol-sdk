import type { Account } from 'thirdweb/wallets'
import { getContract } from 'thirdweb'
import { getInstalledModules } from 'thirdweb/modules'
import { optimismSepolia } from 'thirdweb/chains'
import type { PublishWallet } from './seedSigner'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'
import { getPublishConfig } from '../config'
import { isRouterNonModularCoreAccountError, ManagedAccountPublishError } from '../errors'
import { ensureExecutorModuleInstalled } from './ensureExecutorModule'
import { assertExecutorModuleReadyForAccount } from './executorModuleReadiness'
import {
  ensureAutomationSessionKey,
  removeAutomationSessionKey,
} from './ensureAutomationSessionKey'
import {
  attestPublishAuthorization,
  revokePublishAuthorization,
  type AttestPublishAuthorizationResult,
} from '../services/publishAuthorization'
import { getClient, getManagedAccountWallet } from './thirdweb'

export type EnrollPublishAutomationParams = {
  managedAddress: string
  sessionKeyAddress: string
  /** Optional app label stored in the sidecar (defaults to zero address). */
  appAddress?: string
  /** Unix seconds session / grant end (optional). */
  expiresAt?: number
  /**
   * User-controlled ManagedAccount wallet used to add the session key and attest the sidecar.
   * When omitted, uses the connected managed in-app wallet.
   */
  userWallet?: PublishWallet
}

export type EnrollPublishAutomationResult = {
  managedAddress: string
  sessionKeyAddress: string
  authorization: AttestPublishAuthorizationResult
}

export type RevokePublishAutomationParams = {
  managedAddress: string
  sessionKeyAddress: string
  authorizationUid: string
  userWallet?: PublishWallet
}

async function connectManagedAccount(managedAddress: string): Promise<Account> {
  const managedWallet = getManagedAccountWallet()
  await managedWallet.autoConnect({ client: getClient(), chain: optimismSepolia })
  const account = managedWallet.getAccount()
  if (!account) {
    throw new ManagedAccountPublishError(
      'Could not connect the managed publishing account to enroll or revoke publish automation.',
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
    )
  }
  return account
}

async function resolveUserWallet(
  managedAddress: string,
  userWallet?: PublishWallet,
): Promise<PublishWallet> {
  if (userWallet) return userWallet
  return fromThirdwebAccount(await connectManagedAccount(managedAddress))
}

async function assertExecutorModuleInstalled(managedAddress: string): Promise<void> {
  const config = getPublishConfig()
  const moduleAddr = config.modularAccountModuleContract?.trim()
  if (!moduleAddr) {
    throw new Error(
      '@seedprotocol/publish: enrollPublishAutomation requires PublishConfig.modularAccountModuleContract',
    )
  }

  const twAccount = await connectManagedAccount(managedAddress)
  try {
    await ensureExecutorModuleInstalled(managedAddress, twAccount, config)
  } catch (cause) {
    if (cause instanceof ManagedAccountPublishError) throw cause
    throw new ManagedAccountPublishError(
      'Executor module setup failed for publish automation.',
      'EXECUTOR_MODULE_NOT_INSTALLED',
      managedAddress,
      cause,
    )
  }

  try {
    const accountContract = getContract({
      client: getClient(),
      chain: optimismSepolia,
      address: managedAddress,
    })
    const installed = await getInstalledModules({ contract: accountContract })
    const want = moduleAddr.toLowerCase()
    const ok = installed.some(
      (m: { implementation: string }) => m.implementation?.toLowerCase() === want,
    )
    if (!ok) {
      throw new ManagedAccountPublishError(
        'Executor module is not installed on the ManagedAccount (ModularCore required for automation grants).',
        'EXECUTOR_MODULE_NOT_INSTALLED',
        managedAddress,
      )
    }
  } catch (cause) {
    if (cause instanceof ManagedAccountPublishError) throw cause
    // Legacy Router accounts have no ModularCore install API. Whether the module can act for
    // them is decided below by what the module reports, not by the account type.
    if (!isRouterNonModularCoreAccountError(cause)) {
      throw new ManagedAccountPublishError(
        'Could not verify executor module installation for publish automation.',
        'EXECUTOR_MODULE_NOT_INSTALLED',
        managedAddress,
        cause,
      )
    }
  }

  // The session key may only call the module, so refuse to enroll unless the module can act
  // for this account. Otherwise every automation publish would revert.
  await assertExecutorModuleReadyForAccount(managedAddress)
}

/**
 * Enroll an app automation key: install the executor module when the account is ModularCore,
 * add a module-only session key, then attest the PublishAuthorization sidecar
 * (ManagedAccount attester).
 *
 * @throws ManagedAccountPublishError `AUTOMATION_UNSUPPORTED_ACCOUNT` before adding the session
 * key when the executor module cannot act for the account (e.g. legacy Router ManagedAccounts)
 */
export async function enrollPublishAutomation(
  params: EnrollPublishAutomationParams,
): Promise<EnrollPublishAutomationResult> {
  const { managedAddress, sessionKeyAddress, appAddress, expiresAt } = params

  await assertExecutorModuleInstalled(managedAddress)
  await ensureAutomationSessionKey({
    managedAddress,
    sessionKeyAddress,
    expiresAt,
  })

  const userWallet = await resolveUserWallet(managedAddress, params.userWallet)
  const authorization = await attestPublishAuthorization({
    wallet: userWallet,
    identity: managedAddress,
    sessionKey: sessionKeyAddress,
    app: appAddress,
    expiresAt,
  })

  return {
    managedAddress,
    sessionKeyAddress,
    authorization,
  }
}

/**
 * Disconnect automation: remove session key, then revoke PublishAuthorization sidecar.
 */
export async function revokePublishAutomation(
  params: RevokePublishAutomationParams,
): Promise<void> {
  const { managedAddress, sessionKeyAddress, authorizationUid } = params
  const userWallet = await resolveUserWallet(managedAddress, params.userWallet)

  await removeAutomationSessionKey({
    managedAddress,
    sessionKeyAddress,
  })

  await revokePublishAuthorization({
    wallet: userWallet,
    uid: authorizationUid,
  })
}

import type { Account } from 'thirdweb/wallets'
import type { PublishWallet } from './seedSigner'
import { fromThirdwebAccount } from './adapters/thirdwebAccount'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { ensureExecutorModuleInstalled, type EnsureExecutorModuleResult } from './ensureExecutorModule'
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
import { getPublishThirdwebChain } from './thirdwebChain'

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
  await managedWallet.autoConnect({ client: getClient(), chain: getPublishThirdwebChain() })
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
  let install: EnsureExecutorModuleResult
  try {
    install = await ensureExecutorModuleInstalled(managedAddress, twAccount, config)
  } catch (cause) {
    if (cause instanceof ManagedAccountPublishError) throw cause
    throw new ManagedAccountPublishError(
      'Executor module setup failed for publish automation.',
      'EXECUTOR_MODULE_NOT_INSTALLED',
      managedAddress,
      cause,
    )
  }

  // The session key may only call the module, so refuse to enroll unless the module can act
  // for this account. Otherwise every automation publish would revert. A fresh install is
  // confirmed from its receipt; otherwise the read may still trail an install that just landed.
  await assertExecutorModuleReadyForAccount(
    managedAddress,
    install.status === 'installed'
      ? { installedEas: install.eas }
      : { readAttempts: install.status === 'already-installed' ? 5 : 1 },
  )
}

/**
 * Enroll an app automation key: install the Seed executor (`installSeedExecutor` on Router
 * accounts with the executor router extension), add an executor-only session key, then attest
 * the PublishAuthorization sidecar (ManagedAccount attester).
 *
 * @throws ManagedAccountPublishError `AUTOMATION_UNSUPPORTED_ACCOUNT` before adding the session
 * key when the executor cannot act for the account (e.g. Router accounts without the extension)
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

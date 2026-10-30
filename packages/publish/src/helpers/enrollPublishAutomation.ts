import { PUBLISH_AUTHORIZATION_DEFAULT_EXPIRATION_SECS } from '@seedprotocol/eas'
import type { PublishWallet } from './seedSigner'
import { getPublishConfig } from '../config'
import { ManagedAccountPublishError } from '../errors'
import { assertAutomationExposureAllowed } from './automationExposure'
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

export type EnrollPublishAutomationParams = {
  managedAddress: string
  sessionKeyAddress: string
  /** Optional app label stored in the sidecar (defaults to zero address). */
  appAddress?: string
  /**
   * Unix seconds when the session key and the grant end. Defaults to 90 days from now
   * ({@link PUBLISH_AUTHORIZATION_DEFAULT_EXPIRATION_SECS}); the same value goes to both, so the
   * on-chain key never outlives its PublishAuthorization. Enrolling an active key again moves
   * its end to this value.
   */
  expiresAt?: number
  /**
   * Sends as the ManagedAccount: its `txSender.address` is `managedAddress` (for example
   * `createManagedAccountTxSender`). It sends the session-key grant and attests the sidecar, whose
   * attester must be the account. Its signer, an admin EOA of the account, signs the grant.
   */
  userWallet: PublishWallet
  /**
   * The account's admin EOA, sending from itself. Needed only when the Seed executor isn't
   * installed yet: `installSeedExecutor` is rejected as a self-call from the account.
   */
  admin?: PublishWallet
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
  /** As in {@link EnrollPublishAutomationParams.userWallet}. */
  userWallet: PublishWallet
}

async function assertExecutorModuleInstalled(managedAddress: string, admin?: PublishWallet): Promise<void> {
  const config = getPublishConfig()
  const moduleAddr = config.modularAccountModuleContract?.trim()
  if (!moduleAddr) {
    throw new Error(
      '@seedprotocol/publish: enrollPublishAutomation requires PublishConfig.modularAccountModuleContract',
    )
  }

  const getAdmin = async () => {
    if (admin) return admin
    throw new ManagedAccountPublishError(
      `The Seed executor isn't installed on ${managedAddress}; pass the account's admin EOA as \`admin\` so it can send installSeedExecutor.`,
      'EXECUTOR_MODULE_NOT_INSTALLED',
      managedAddress,
    )
  }
  let install: EnsureExecutorModuleResult
  try {
    install = await ensureExecutorModuleInstalled(managedAddress, getAdmin, config)
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

function assertSendsAsAccount(managedAddress: string, userWallet: PublishWallet): void {
  if (userWallet.txSender.address.toLowerCase() !== managedAddress.toLowerCase()) {
    throw new ManagedAccountPublishError(
      `userWallet sends from ${userWallet.txSender.address}, not the publishing account ${managedAddress}; the PublishAuthorization must be attested by the account.`,
      'MANAGED_ACCOUNT_UNAVAILABLE',
      managedAddress,
    )
  }
}

/**
 * Enroll an app automation key: install the Seed executor (`installSeedExecutor` on Router
 * accounts with the executor router extension), add an executor-only session key, then attest
 * the PublishAuthorization sidecar (ManagedAccount attester).
 *
 * @throws ManagedAccountPublishError `MANAGED_ACCOUNT_UNAVAILABLE` before sending anything when
 * `userWallet` doesn't send as `managedAddress`
 * @throws ManagedAccountPublishError `AUTOMATION_ACCOUNT_FUNDED` before sending anything when the
 * account holds more ETH than {@link PublishConfig.maxAutomationExposureWei}
 * @throws ManagedAccountPublishError `AUTOMATION_UNSUPPORTED_ACCOUNT` before adding the session
 * key when the executor cannot act for the account (e.g. Router accounts without the extension)
 */
export async function enrollPublishAutomation(
  params: EnrollPublishAutomationParams,
): Promise<EnrollPublishAutomationResult> {
  const { managedAddress, sessionKeyAddress, appAddress } = params
  const expiresAt =
    typeof params.expiresAt === 'number' && params.expiresAt > 0
      ? Math.trunc(params.expiresAt)
      : Math.floor(Date.now() / 1000) + PUBLISH_AUTHORIZATION_DEFAULT_EXPIRATION_SECS

  const { userWallet } = params
  assertSendsAsAccount(managedAddress, userWallet)
  await assertAutomationExposureAllowed(managedAddress)
  await assertExecutorModuleInstalled(managedAddress, params.admin)
  await ensureAutomationSessionKey({
    managedAddress,
    sessionKeyAddress,
    expiresAt,
    admin: userWallet,
  })

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
  const { managedAddress, sessionKeyAddress, authorizationUid, userWallet } = params
  assertSendsAsAccount(managedAddress, userWallet)

  await removeAutomationSessionKey({
    managedAddress,
    sessionKeyAddress,
    admin: userWallet,
  })

  await revokePublishAuthorization({
    wallet: userWallet,
    uid: authorizationUid,
  })
}

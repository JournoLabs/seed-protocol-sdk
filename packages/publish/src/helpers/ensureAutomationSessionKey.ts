import type { Address } from 'viem'
import { ManagedAccountPublishError } from '../errors'
import { isContractDeployed, readUntil } from './chainClient'
import { readIsActiveSigner } from './contracts'
import { buildAutomationSessionKeyPermissions } from './automationSessionKeyPermissions'
import { getPublishChainName } from './chainConfig'
import type { PublishWallet } from './seedSigner'
import { REMOVE_SESSION_KEY, sessionKeyNeedsGrant, setSessionKeyPermissions } from './sessionKeys'

const MSG_ACTIVATION_FAILED = () =>
  `Could not authorize the automation session key on your publishing account on ${getPublishChainName()}.`
const MSG_REMOVAL_FAILED = () =>
  `Could not remove the automation session key from your publishing account on ${getPublishChainName()}.`

/**
 * Ensures `sessionKeyAddress` is an active automation session signer on the ManagedAccount
 * with **executor-module-only** approved targets. `admin.signer` (an admin EOA of the account)
 * signs the grant and `admin.txSender` sends it; see {@link setSessionKeyPermissions}.
 */
export async function ensureAutomationSessionKey(params: {
  managedAddress: string
  sessionKeyAddress: string
  /** Unix seconds end time for the session key (optional). */
  expiresAt?: number
  admin: PublishWallet
}): Promise<void> {
  const { managedAddress, sessionKeyAddress, expiresAt, admin } = params
  const { approvedTargets } = buildAutomationSessionKeyPermissions({ expiresAt })
  const grant = { approvedTargets, ...(expiresAt != null && expiresAt > 0 && { endsAt: expiresAt }) }

  let shouldUpdate = false
  try {
    shouldUpdate = await sessionKeyNeedsGrant(managedAddress as Address, sessionKeyAddress as Address, grant)
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED(),
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }

  if (shouldUpdate) {
    await setSessionKeyPermissions({
      managedAddress: managedAddress as Address,
      sessionKeyAddress: sessionKeyAddress as Address,
      grant,
      admin,
      failureMessage: MSG_ACTIVATION_FAILED(),
    })
  }

  // Right after the grant, a lagging RPC node can still report the key inactive.
  const active = await readUntil(
    () => isAutomationSessionActive(managedAddress, sessionKeyAddress),
    Boolean,
    { attempts: shouldUpdate ? 5 : 1 },
  )
  if (!active) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED(),
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
    )
  }
}

/**
 * Removes an automation session key from the ManagedAccount. `admin` signs and sends as in
 * {@link ensureAutomationSessionKey}. An undeployed account has no keys, so there is nothing to send.
 */
export async function removeAutomationSessionKey(params: {
  managedAddress: string
  sessionKeyAddress: string
  admin: PublishWallet
}): Promise<void> {
  if (!(await isContractDeployed(params.managedAddress))) return
  await setSessionKeyPermissions({
    managedAddress: params.managedAddress as Address,
    sessionKeyAddress: params.sessionKeyAddress as Address,
    grant: REMOVE_SESSION_KEY,
    admin: params.admin,
    failureMessage: MSG_REMOVAL_FAILED(),
  })
}

/**
 * True when `sessionKeyAddress` is an active signer on the ManagedAccount.
 * Returns `false` when the ManagedAccount has no bytecode (undeployed ≠ unauthorized).
 * Throws when bytecode or `isActiveSigner` cannot be read on a live account (RPC / decode),
 * so unattended automation does not silently fall through to in-app bootstrap.
 */
export async function isAutomationSessionActive(
  managedAddress: string,
  sessionKeyAddress: string,
): Promise<boolean> {
  try {
    if (!(await isContractDeployed(managedAddress))) {
      return false
    }
    return await readIsActiveSigner(
      managedAddress as Address,
      sessionKeyAddress as Address,
    )
  } catch (cause) {
    throw new ManagedAccountPublishError(
      MSG_ACTIVATION_FAILED(),
      'MODULAR_SIGNER_ACTIVATION_FAILED',
      managedAddress,
      cause,
    )
  }
}

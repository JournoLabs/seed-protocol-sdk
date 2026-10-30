import {
  bytesToHex,
  isAddressEqual,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from 'viem'
import { ManagedAccountPublishError } from '../errors'
import { signerPermissionRequestTypes } from './abi/accountPermissions'
import { getPublishViemChain } from './chainConfig'
import { isContractDeployed, waitForPublishReceipt } from './chainClient'
import {
  encodeSetPermissionsForSigner,
  readIsAdmin,
  readPermissionsForSigner,
  type SignerPermissionRequest,
} from './contracts'
import { requireSignTypedData, type PublishWallet } from './seedSigner'

/** How long a signed grant can be sent. The account accepts one from any sender until then. */
const REQUEST_VALIDITY_SECS = 60n * 60n

export type SessionKeyGrant = {
  /** Targets the key may call through the account; `[]` removes the key. */
  approvedTargets: readonly Address[]
  /** Unix seconds the key starts working. Default 0. */
  startsAt?: number
  /** Unix seconds the key stops working. */
  endsAt: number
}

function nowSecs(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

function randomUid(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
}

/**
 * Whether the account's permissions for `sessionKeyAddress` differ from `grant`: an undeployed
 * account, another end time (so a grant both renews and shortens a key), or targets that aren't
 * exactly `grant.approvedTargets`. A grant replaces the key's whole target list.
 */
export async function sessionKeyNeedsGrant(
  managedAddress: Address,
  sessionKeyAddress: Address,
  grant: SessionKeyGrant,
): Promise<boolean> {
  if (!(await isContractDeployed(managedAddress))) return true
  const current = await readPermissionsForSigner(managedAddress, sessionKeyAddress)
  if (current.endTimestamp !== BigInt(grant.endsAt)) return true
  if (current.approvedTargets.length !== grant.approvedTargets.length) return true
  return !grant.approvedTargets.every((target) =>
    current.approvedTargets.some((have) => isAddressEqual(have, target)),
  )
}

/**
 * Sets `sessionKeyAddress`'s permissions on a ManagedAccount. `admin.signer` signs the request and
 * must be an admin of the account (its EOA, not the account itself); `admin.txSender` sends
 * `setPermissionsForSigner`, which the account accepts from any sender. An undeployed account can
 * only be set up by a sender that is the account, whose first UserOp deploys it.
 *
 * @throws ManagedAccountPublishError `MODULAR_SIGNER_ACTIVATION_FAILED` with `failureMessage` when
 *   the signer isn't an admin, the account isn't deployed and can't be, or the transaction fails
 */
export async function setSessionKeyPermissions(params: {
  managedAddress: Address
  sessionKeyAddress: Address
  grant: SessionKeyGrant
  admin: PublishWallet
  failureMessage: string
}): Promise<void> {
  const { managedAddress, sessionKeyAddress, grant, admin, failureMessage } = params
  const fail = (cause?: unknown) =>
    new ManagedAccountPublishError(failureMessage, 'MODULAR_SIGNER_ACTIVATION_FAILED', managedAddress, cause)

  const req: SignerPermissionRequest = {
    signer: sessionKeyAddress,
    isAdmin: 0,
    approvedTargets: grant.approvedTargets,
    nativeTokenLimitPerTransaction: 0n,
    permissionStartTimestamp: BigInt(grant.startsAt ?? 0),
    permissionEndTimestamp: BigInt(grant.endsAt),
    reqValidityStartTimestamp: 0n,
    reqValidityEndTimestamp: nowSecs() + REQUEST_VALIDITY_SECS,
    uid: randomUid(),
  }
  const typedData = {
    domain: {
      name: 'Account',
      version: '1',
      chainId: getPublishViemChain().id,
      verifyingContract: managedAddress,
    },
    types: signerPermissionRequestTypes,
    primaryType: 'SignerPermissionRequest',
    message: req,
  } as const

  let signature: Hex
  let signedBy: Address
  let deployed: boolean
  let signedByAdmin = false
  try {
    signature = await requireSignTypedData(admin.signer)(typedData)
    signedBy = await recoverTypedDataAddress({ ...typedData, signature })
    deployed = await isContractDeployed(managedAddress)
    if (deployed) signedByAdmin = await readIsAdmin(managedAddress, signedBy)
  } catch (cause) {
    throw fail(cause)
  }

  // The account reverts with a bare `!sig` for a non-admin signature; say who signed instead.
  if (deployed && !signedByAdmin) {
    throw fail(`${signedBy} signed the session-key request but is not an admin of ${managedAddress}`)
  }
  if (!deployed && !isAddressEqual(admin.txSender.address, managedAddress)) {
    throw fail(
      `${managedAddress} is not deployed; send the grant as the account (a UserOp) so it deploys, or deploy it first`,
    )
  }

  try {
    const { transactionHash } = await admin.txSender.sendTransaction(
      encodeSetPermissionsForSigner(managedAddress, req, signature),
    )
    await waitForPublishReceipt(transactionHash)
  } catch (cause) {
    throw fail(cause)
  }
}

/** The grant that removes a key, as thirdweb's `removeSessionKey` sends it. */
export const REMOVE_SESSION_KEY: SessionKeyGrant = { approvedTargets: [], startsAt: 0, endsAt: 0 }

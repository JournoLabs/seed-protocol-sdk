import { prepareEasMultiRevoke } from '~/helpers/easDirect'
import { getPublishPublicClient, waitForPublishReceipt } from '~/helpers/chainClient'
import { easAbi } from '~/helpers/abi/eas'
import { findRevertData } from '~/helpers/describeRevert'
import { getPublishWallet } from '~/helpers/publishWalletRegistry'
import { fromThirdwebAccount } from '~/helpers/adapters/thirdwebAccount'
import type { PublishWallet } from '~/helpers/seedSigner'
import type { Hex } from 'viem'
import { getPublishConfig } from '~/config'
import { verifyPublishChain } from '~/helpers/verifyPublishChain'
import {
  getVersionsForSeedUid,
  getMetadataAttestationUidsForSeedUid,
  getAttesterForSeed,
  updateSeedRevokedAt,
  VERSION_SCHEMA_UID,
  isValidEasAttestationUid,
  getGetAdditionalSyncAddresses,
  assertLocalDbChain,
} from '@seedprotocol/sdk'

/**
 * True when the EAS attester is the configured executor module (legacy path where the
 * module itself was recorded as attester). ManagedAccount attesters are not blocked.
 */
async function isLegacyModularExecutorAttester(attester: string | null): Promise<boolean> {
  if (!attester) return false
  const additionalGetter = getGetAdditionalSyncAddresses()
  if (!additionalGetter) return false
  const additional = await additionalGetter()
  const attesterLower = attester.toLowerCase()
  return !!additional?.some((a: string | undefined) => a?.toLowerCase() === attesterLower)
}

/**
 * True when `wallet` is an automation session key on the ManagedAccount that attested the seed.
 * Read failures count as false: the revoke then goes to EAS, and the account rejects it.
 */
async function isAutomationRevoke(
  wallet: PublishWallet,
  attester: string | null,
): Promise<boolean> {
  if (!attester || !getPublishConfig().modularAccountModuleContract?.trim()) return false
  const signerAddress = wallet.signer?.address
  if (!signerAddress || signerAddress.toLowerCase() === attester.toLowerCase()) return false
  try {
    const { isAutomationSessionActive } = await import('~/helpers/ensureAutomationSessionKey')
    return await isAutomationSessionActive(attester, signerAddress)
  } catch {
    return false
  }
}

const ALREADY_REVOKED_SELECTOR = '0x905e7107'
const ACCESS_DENIED_SELECTOR = '0x4ca88867'

function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

function revertMatches(err: unknown, name: string, selector: string): boolean {
  const data = findRevertData(err)
  if (data?.toLowerCase().startsWith(selector)) return true
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes(name) || msg.toLowerCase().includes(selector)
}

/**
 * Picks the wallet that sends `multiRevoke`: it must be the attester, since EAS lets only the
 * attester revoke. The registered wallet is used when it is the attester. Otherwise (no wallet
 * registered, or the registered one is a different account, e.g. the in-app admin wallet that
 * ConnectButton registers under `useModularExecutor` while the ManagedAccount attested) the
 * connected Thirdweb account is resolved to the attester's account. When that fails and a wallet
 * is registered, the registered wallet is kept: the automation check below, or EAS's
 * AccessDenied, then says why it cannot revoke.
 */
async function resolveRevokeWallet(attester: string | null): Promise<PublishWallet> {
  const registered = getPublishWallet()
  if (registered && (!attester || sameAddress(registered.txSender.address, attester))) {
    return registered
  }
  try {
    const { getConnectedAccount } = await import('~/helpers/thirdweb')
    const { resolveRevokeAccount } = await import('~/helpers/resolveRevokeAccount')
    const account = await getConnectedAccount()
    if (!account) {
      throw new Error('No wallet connected. Connect a wallet to revoke attestations.')
    }
    const revokeAccount = await resolveRevokeAccount({ account, attester })
    if (!registered || sameAddress(revokeAccount.address, attester)) {
      return fromThirdwebAccount(revokeAccount)
    }
  } catch (err) {
    if (registered) return registered
    if (err instanceof Error && err.message.includes('No wallet connected')) throw err
    if (err instanceof Error && err.message.includes('Revocation not supported')) throw err
    throw new Error(
      'No wallet connected. Use useSeedWallet / setPublishWallet, or @seedprotocol/publish/thirdweb ConnectButton.',
      { cause: err },
    )
  }
  return registered
}

/**
 * UIDs among `uids` that EAS already shows as revoked. A failed read counts as not revoked:
 * the revoke is then sent, and an AlreadyRevoked revert is handled by the caller.
 */
async function findRevokedUids(uids: readonly Hex[]): Promise<Set<string>> {
  const revoked = new Set<string>()
  const { easContractAddress } = getPublishConfig()
  if (!easContractAddress || uids.length === 0) return revoked
  let client: ReturnType<typeof getPublishPublicClient>
  try {
    client = getPublishPublicClient()
  } catch {
    return revoked
  }
  await Promise.all(
    uids.map(async (uid) => {
      try {
        const attestation = await client.readContract({
          address: easContractAddress as Hex,
          abi: easAbi,
          functionName: 'getAttestation',
          args: [uid],
        })
        if (attestation.revocationTime > 0n) revoked.add(uid.toLowerCase())
      } catch {
        // Unknown state: leave it in the batch.
      }
    }),
  )
  return revoked
}

/**
 * Sends one per-schema `multiRevoke`, leaving out uids EAS already shows as revoked. EAS reverts
 * the whole batch on one already-revoked uid, so on AlreadyRevoked the state is read again and
 * the rest are sent once more. A batch of one that reverts AlreadyRevoked is done.
 */
async function revokeBatch(
  txSender: PublishWallet['txSender'],
  req: { schema: Hex; data: Array<{ uid: Hex; value?: bigint }> },
): Promise<void> {
  let data = req.data
  for (let attempt = 0; ; attempt++) {
    const revoked = await findRevokedUids(data.map((d) => d.uid))
    data = data.filter((d) => !revoked.has(d.uid.toLowerCase()))
    if (data.length === 0) return
    try {
      const result = await txSender.sendTransaction(prepareEasMultiRevoke([{ schema: req.schema, data }]))
      await waitForPublishReceipt(result.transactionHash)
      return
    } catch (err: unknown) {
      if (revertMatches(err, 'AccessDenied', ACCESS_DENIED_SELECTOR)) {
        throw new Error(
          'Only the original attester can revoke attestations. Connect the wallet that published this item.',
        )
      }
      if (!revertMatches(err, 'AlreadyRevoked', ALREADY_REVOKED_SELECTOR)) throw err
      if (data.length === 1) return
      if (attempt > 0) {
        throw new Error(
          `multiRevoke for schema ${req.schema} reverted with AlreadyRevoked, and EAS could not be read to tell which of its ${data.length} attestations are already revoked. Retry the revoke.`,
          { cause: err },
        )
      }
    }
  }
}

/**
 * Revokes the Seed attestation and all Version and metadata attestations on EAS.
 * Sends from the attester: the registered publish wallet when it is the attester, else the
 * connected Thirdweb account resolved to the attester (see {@link resolveRevokeWallet}).
 *
 * Only the attester's owner can revoke: `multiRevoke` goes to EAS from the publishing account
 * (for a ManagedAccount, a UserOp `execute(EAS, multiRevoke)`). The Seed executor has no revoke,
 * so automation session keys and seeds attested by the executor itself cannot be revoked here.
 */
export async function revokeAttestations(params: {
  seedLocalId: string
  seedUid: string
  seedSchemaUid: string
}): Promise<void> {
  const { seedLocalId, seedUid, seedSchemaUid } = params
  // Revoking on one chain must not update revokedAt for a seed attested on another.
  await assertLocalDbChain()
  await verifyPublishChain()
  const attester = await getAttesterForSeed({ seedLocalId, seedUid })
  if (await isLegacyModularExecutorAttester(attester)) {
    throw new Error(
      'Revocation not supported for items attested by the Seed executor module: the executor has no revoke and is the only attester that could revoke them.',
    )
  }

  const wallet = await resolveRevokeWallet(attester)

  const txSender = wallet.txSender
  if (await isAutomationRevoke(wallet, attester)) {
    throw new Error(
      'Automation session keys cannot revoke attestations. Revoking is owner-only: connect the account that published this item.',
    )
  }

  const [versionRows, metadataRows] = await Promise.all([
    getVersionsForSeedUid(seedUid),
    getMetadataAttestationUidsForSeedUid(seedUid),
  ])

  const versionUids = versionRows
    .map((r: { uid: string }) => r.uid)
    .filter((uid: string) => isValidEasAttestationUid(uid))
  const metadataBySchema = new Map<string, string[]>()
  for (const { uid, schemaUid } of metadataRows) {
    if (!isValidEasAttestationUid(uid)) continue
    const list = metadataBySchema.get(schemaUid) ?? []
    list.push(uid)
    metadataBySchema.set(schemaUid, list)
  }

  const requests: Array<{
    schema: `0x${string}`
    data: Array<{ uid: `0x${string}`; value?: bigint }>
  }> = []

  for (const [schemaUid, uids] of metadataBySchema) {
    if (uids.length > 0) {
      requests.push({
        schema: schemaUid as `0x${string}`,
        data: uids.map((uid: string) => ({ uid: uid as `0x${string}` })),
      })
    }
  }

  if (versionUids.length > 0) {
    requests.push({
      schema: VERSION_SCHEMA_UID as `0x${string}`,
      data: versionUids.map((uid: string) => ({ uid: uid as `0x${string}` })),
    })
  }

  requests.push({
    schema: seedSchemaUid as `0x${string}`,
    data: [{ uid: seedUid as `0x${string}` }],
  })

  for (const req of requests) {
    if (req.data.length === 0) continue
    await revokeBatch(txSender, req)
  }

  const revokedAt = Math.floor(Date.now() / 1000)
  // Mark the revoked version and property attestations too, so local rows read as revoked before the
  // next EAS sync confirms it (sync keeps them as the item's last values, see ADR 0006).
  await updateSeedRevokedAt({
    seedLocalId,
    revokedAt,
    metadataUids: [...metadataBySchema.values()].flat(),
    versionUids,
  })
}

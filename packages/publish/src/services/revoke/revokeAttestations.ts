import { getClient } from '~/helpers/thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { sendTransaction, waitForReceipt } from 'thirdweb'
import { getConnectedAccount } from '~/helpers/thirdweb'
import { prepareEasMultiRevoke } from '~/helpers/easDirect'
import { resolveRevokeAccount } from '~/helpers/resolveRevokeAccount'
import {
  getVersionsForSeedUid,
  getMetadataAttestationUidsForSeedUid,
  getAttesterForSeed,
  updateSeedRevokedAt,
  VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
  isValidEasAttestationUid,
} from '@seedprotocol/sdk'

/**
 * Revokes the Seed attestation and all Version and metadata attestations on EAS.
 * Updates local DB with revokedAt timestamp.
 *
 * Order: metadata first, then versions, then seed (children before parents).
 */
export async function revokeAttestations(params: {
  seedLocalId: string
  seedUid: string
  seedSchemaUid: string
}): Promise<void> {
  const { seedLocalId, seedUid, seedSchemaUid } = params

  const account = await getConnectedAccount()
  if (!account) {
    throw new Error('No wallet connected. Connect a wallet to revoke attestations.')
  }

  const attester = await getAttesterForSeed({ seedLocalId, seedUid })
  const revokeAccount = await resolveRevokeAccount({ account, attester })

  const client = getClient()

  // Collect attestation UIDs to revoke
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

  // Metadata attestations (group by schema)
  for (const [schemaUid, uids] of metadataBySchema) {
    if (uids.length > 0) {
      requests.push({
        schema: schemaUid as `0x${string}`,
        data: uids.map((uid: string) => ({ uid: uid as `0x${string}` })),
      })
    }
  }

  // Version attestations
  if (versionUids.length > 0) {
    requests.push({
      schema: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA as `0x${string}`,
      data: versionUids.map((uid: string) => ({ uid: uid as `0x${string}` })),
    })
  }

  // Seed attestation
  requests.push({
    schema: seedSchemaUid as `0x${string}`,
    data: [{ uid: seedUid as `0x${string}` }],
  })

  // Execute multiRevoke in batches if needed (EAS may have limits)
  for (const req of requests) {
    if (req.data.length === 0) continue
    const multiRevokeTx = prepareEasMultiRevoke(client, optimismSepolia, [req])
    try {
      const result = await sendTransaction({ account: revokeAccount, transaction: multiRevokeTx })
      await waitForReceipt({
        client,
        chain: optimismSepolia,
        transactionHash: result.transactionHash,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // EAS AccessDenied: only the original attester can revoke (selector 0x4ca88867)
      if (msg.includes('AccessDenied') || msg.includes('0x4ca88867')) {
        throw new Error(
          'Only the original attester can revoke attestations. Connect the wallet that published this item.',
        )
      }
      // AlreadyRevoked: attestation was already revoked (e.g. double-click, stale UI)
      if (msg.includes('AlreadyRevoked')) {
        continue
      }
      throw err
    }
  }

  const revokedAt = Math.floor(Date.now() / 1000)
  await updateSeedRevokedAt({ seedLocalId, revokedAt })
}

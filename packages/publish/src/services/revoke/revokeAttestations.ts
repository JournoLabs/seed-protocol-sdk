import { getClient } from '~/helpers/thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { sendTransaction, waitForReceipt } from 'thirdweb'
import { getConnectedAccount } from '~/helpers/thirdweb'
import { getPublishConfig } from '~/config'
import { prepareEasMultiRevoke } from '~/helpers/easDirect'
import {
  getVersionsForSeedUid,
  getMetadataAttestationUidsForSeedUid,
  updateSeedRevokedAt,
  VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA,
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

  const client = getClient()

  // Collect attestation UIDs to revoke
  const [versionRows, metadataRows] = await Promise.all([
    getVersionsForSeedUid(seedUid),
    getMetadataAttestationUidsForSeedUid(seedUid),
  ])

  const versionUids = versionRows.map((r) => r.uid)
  const metadataBySchema = new Map<string, string[]>()
  for (const { uid, schemaUid } of metadataRows) {
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
        data: uids.map((uid) => ({ uid: uid as `0x${string}` })),
      })
    }
  }

  // Version attestations
  if (versionUids.length > 0) {
    requests.push({
      schema: VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA as `0x${string}`,
      data: versionUids.map((uid) => ({ uid: uid as `0x${string}` })),
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
    const result = await sendTransaction({ account, transaction: multiRevokeTx })
    await waitForReceipt({
      client,
      chain: optimismSepolia,
      transactionHash: result.transactionHash,
    })
  }

  const revokedAt = Math.floor(Date.now() / 1000)
  await updateSeedRevokedAt({ seedLocalId, revokedAt })
}

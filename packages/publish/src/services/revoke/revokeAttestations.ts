import { prepareEasMultiRevoke } from '~/helpers/easDirect'
import { waitForPublishReceipt } from '~/helpers/chainClient'
import { getPublishWallet } from '~/helpers/publishWalletRegistry'
import { fromThirdwebAccount } from '~/helpers/adapters/thirdwebAccount'
import type { PublishWallet } from '~/helpers/seedSigner'
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

/**
 * Revokes the Seed attestation and all Version and metadata attestations on EAS.
 * Prefer the registered publish wallet; fall back to Thirdweb connected account when present.
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

  let wallet: PublishWallet | null = getPublishWallet()
  if (!wallet) {
    try {
      const { getConnectedAccount } = await import('~/helpers/thirdweb')
      const { resolveRevokeAccount } = await import('~/helpers/resolveRevokeAccount')
      const account = await getConnectedAccount()
      if (!account) {
        throw new Error('No wallet connected. Connect a wallet to revoke attestations.')
      }
      const revokeAccount = await resolveRevokeAccount({ account, attester })
      wallet = fromThirdwebAccount(revokeAccount)
    } catch (err) {
      if (err instanceof Error && err.message.includes('No wallet connected')) throw err
      if (err instanceof Error && err.message.includes('Revocation not supported')) throw err
      throw new Error(
        'No wallet connected. Use useSeedWallet / setPublishWallet, or @seedprotocol/publish/thirdweb ConnectButton.',
        { cause: err },
      )
    }
  }

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
    const multiRevokeTx = prepareEasMultiRevoke([req])
    try {
      const result = await txSender.sendTransaction(multiRevokeTx)
      await waitForPublishReceipt(result.transactionHash)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('AccessDenied') || msg.includes('0x4ca88867')) {
        throw new Error(
          'Only the original attester can revoke attestations. Connect the wallet that published this item.',
        )
      }
      if (msg.includes('AlreadyRevoked')) {
        continue
      }
      throw err
    }
  }

  const revokedAt = Math.floor(Date.now() / 1000)
  // Mark the revoked property attestations too, so local metadata reads as revoked before the next
  // EAS sync confirms it (sync keeps them as the item's last values, see ADR 0006).
  await updateSeedRevokedAt({
    seedLocalId,
    revokedAt,
    metadataUids: [...metadataBySchema.values()].flat(),
  })
}

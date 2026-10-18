import { inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { selectInBatches, writeInBatches } from '@/db/sqlParamBatches'
import { metadata, seeds, versions } from '@/seedSchema'
import { normalizePublisher } from '@/helpers/addresses'
import { isLocalUnsealedDraft, type SeedOwnershipRow } from '@/helpers/ownership'

type ClaimableRow = SeedOwnershipRow & { localId: string | null }

export type ClaimUnpublishedDraftsResult = {
  seeds: number
  versions: number
  metadata: number
  /** Local ids of the claimed seeds, so loaded Items can take the new publisher. */
  seedLocalIds: string[]
}

const emptyResult = (): ClaimUnpublishedDraftsResult => ({
  seeds: 0,
  versions: 0,
  metadata: 0,
  seedLocalIds: [],
})

/**
 * Gives `publisher` to local drafts that belong to no wallet yet: seeds with no publisher, no real
 * uid and no attestationRaw, and those seeds' versions and property rows that are unsealed too.
 * Versions and property rows go only with their seed, so rows of a seed that already has a
 * publisher are never claimed. Sealed rows (real EAS uid or attestationRaw) are never touched.
 */
export async function claimUnpublishedDrafts(
  publisher: string,
): Promise<ClaimUnpublishedDraftsResult> {
  const normalized = normalizePublisher(publisher)
  if (!normalized) return emptyResult()

  const appDb = BaseDb.getAppDb()
  if (!appDb) return emptyResult()

  const now = Date.now()

  const isClaimable = (row: ClaimableRow): row is ClaimableRow & { localId: string } =>
    typeof row.localId === 'string' && row.localId !== '' && isLocalUnsealedDraft(row)

  const stamp = async (table: typeof seeds | typeof versions | typeof metadata, ids: string[]) => {
    await writeInBatches(ids, (chunk) =>
      appDb.update(table).set({ publisher: normalized, updatedAt: now }).where(inArray(table.localId, chunk)),
    )
  }

  const seedRows = (await appDb
    .select({
      localId: seeds.localId,
      uid: seeds.uid,
      publisher: seeds.publisher,
      attestationRaw: seeds.attestationRaw,
    })
    .from(seeds)) as ClaimableRow[]
  const seedIds = seedRows.filter(isClaimable).map((row) => row.localId)
  if (seedIds.length === 0) return emptyResult()

  const claimChildren = async (table: typeof versions | typeof metadata): Promise<string[]> => {
    const rows = (await selectInBatches(seedIds, (chunk) =>
      appDb
        .select({
          localId: table.localId,
          uid: table.uid,
          publisher: table.publisher,
          attestationRaw: table.attestationRaw,
        })
        .from(table)
        .where(inArray(table.seedLocalId, chunk)),
    )) as ClaimableRow[]
    const ids = rows.filter(isClaimable).map((row) => row.localId)
    await stamp(table, ids)
    return ids
  }

  await stamp(seeds, seedIds)
  const versionIds = await claimChildren(versions)
  const metadataIds = await claimChildren(metadata)

  return {
    seeds: seedIds.length,
    versions: versionIds.length,
    metadata: metadataIds.length,
    seedLocalIds: seedIds,
  }
}

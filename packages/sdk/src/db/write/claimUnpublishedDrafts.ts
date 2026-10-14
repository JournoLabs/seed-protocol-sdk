import { inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
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
 * Stamp local seeds/versions/metadata that have no publisher and no real uid.
 * Does not touch sealed rows (real EAS uid or attestationRaw).
 */
export async function claimUnpublishedDrafts(
  publisher: string,
): Promise<ClaimUnpublishedDraftsResult> {
  const normalized = normalizePublisher(publisher)
  if (!normalized) return emptyResult()

  const appDb = BaseDb.getAppDb()
  if (!appDb) return emptyResult()

  const now = Date.now()

  const claimTable = async (
    table: typeof seeds | typeof versions | typeof metadata,
  ): Promise<string[]> => {
    const rows = (await appDb
      .select({
        localId: table.localId,
        uid: table.uid,
        publisher: table.publisher,
        attestationRaw: table.attestationRaw,
      })
      .from(table)) as ClaimableRow[]

    const ids = rows
      .filter(
        (row: ClaimableRow): row is ClaimableRow & { localId: string } =>
          typeof row.localId === 'string' &&
          row.localId !== '' &&
          isLocalUnsealedDraft(row),
      )
      .map((row: ClaimableRow & { localId: string }) => row.localId)

    if (ids.length === 0) return []

    await appDb
      .update(table)
      .set({ publisher: normalized, updatedAt: now })
      .where(inArray(table.localId, ids))

    return ids
  }

  const [seedIds, versionIds, metadataIds] = await Promise.all([
    claimTable(seeds),
    claimTable(versions),
    claimTable(metadata),
  ])

  return {
    seeds: seedIds.length,
    versions: versionIds.length,
    metadata: metadataIds.length,
    seedLocalIds: seedIds,
  }
}

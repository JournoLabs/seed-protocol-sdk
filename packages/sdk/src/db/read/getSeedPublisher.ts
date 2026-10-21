import { BaseDb } from '@/db/Db/BaseDb'
import { findSeedRow } from '@/db/read/findSeedRow'
import { normalizePublisher } from '@/helpers/addresses'
import { resolvePublisherFromSeedRow } from '@/helpers/ownership'

/**
 * The publisher a seed's version and property rows take: the seed's own (its `publisher`, else the
 * attester of its stored attestation). Undefined for a draft that belongs to no wallet yet; those
 * rows are then claimed together with their seed (claimUnpublishedDrafts).
 */
export async function getSeedPublisher(
  seedLocalId: string | null | undefined,
  /** The database or transaction to read; the app database by default. */
  db: ReturnType<typeof BaseDb.getAppDb> = BaseDb.getAppDb(),
): Promise<string | undefined> {
  if (!seedLocalId) return undefined
  const row = await findSeedRow({ localId: seedLocalId }, db)
  if (!row) return undefined
  return normalizePublisher(resolvePublisherFromSeedRow(row))
}

import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { normalizePublisher } from '@/helpers/addresses'
import { resolvePublisherFromSeedRow } from '@/helpers/ownership'

/**
 * The publisher a seed's version and property rows take: the seed's own (its `publisher`, else the
 * attester of its stored attestation). Undefined for a draft that belongs to no wallet yet; those
 * rows are then claimed together with their seed (claimUnpublishedDrafts).
 */
export async function getSeedPublisher(seedLocalId: string | null | undefined): Promise<string | undefined> {
  if (!seedLocalId) return undefined
  const appDb = BaseDb.getAppDb()
  if (!appDb) return undefined
  const [row] = await appDb
    .select({ publisher: seeds.publisher, attestationRaw: seeds.attestationRaw, uid: seeds.uid })
    .from(seeds)
    .where(eq(seeds.localId, seedLocalId))
    .limit(1)
  if (!row) return undefined
  return normalizePublisher(resolvePublisherFromSeedRow(row))
}

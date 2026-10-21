import { and, inArray, isNotNull } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { selectInBatches } from '@/db/sqlParamBatches'
import { seeds, versions } from '@/seedSchema'
import type { SeedType } from '@/seedSchema'

/**
 * The local seed row for each seed attestation uid. A uid recorded on a seed's versions
 * (`versions.seed_uid`) belongs to that seed: its current uid, or an old one from before it was
 * unpublished and published again (the seed row then holds the new uid, the old version rows keep
 * the old one). A uid no version records resolves by `seeds.uid`. Uids with no local seed are left
 * out of the map.
 *
 * Going through versions first also resolves a republished seed's old uid to the item when an
 * older sync left a second, version-less seed row with that uid (migration 0024 removes those).
 */
export const findSeedRowsByUid = async (uids: readonly string[]): Promise<Map<string, SeedType>> => {
  const result = new Map<string, SeedType>()
  const appDb = BaseDb.getAppDb()
  const wanted = [...new Set(uids.filter(Boolean))]
  if (!appDb || wanted.length === 0) return result

  const owners: { seedUid: string | null; seedLocalId: string | null }[] = await selectInBatches(
    wanted,
    (chunk) =>
      appDb
        .selectDistinct({ seedUid: versions.seedUid, seedLocalId: versions.seedLocalId })
        .from(versions)
        .where(and(inArray(versions.seedUid, chunk), isNotNull(versions.seedLocalId))),
  )
  const ownerLocalIds = [...new Set(owners.map((o) => o.seedLocalId!))]
  const ownerRows: SeedType[] = await selectInBatches(ownerLocalIds, (chunk) =>
    appDb.select().from(seeds).where(inArray(seeds.localId, chunk)),
  )
  const ownerByLocalId = new Map(ownerRows.map((row) => [row.localId, row]))
  for (const { seedUid, seedLocalId } of owners) {
    const row = ownerByLocalId.get(seedLocalId)
    if (!seedUid || !row) continue
    // Versions of two seeds recording one uid shouldn't happen; the seed that holds it wins.
    const current = result.get(seedUid)
    if (!current || (current.uid !== seedUid && row.uid === seedUid)) result.set(seedUid, row)
  }

  const rest = wanted.filter((uid) => !result.has(uid))
  const byUid: SeedType[] = await selectInBatches(rest, (chunk) =>
    appDb.select().from(seeds).where(inArray(seeds.uid, chunk)),
  )
  for (const row of byUid) {
    if (row.uid && !result.has(row.uid)) result.set(row.uid, row)
  }
  return result
}

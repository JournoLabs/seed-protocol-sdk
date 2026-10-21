import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { inArray } from 'drizzle-orm'
import { isVersionRevoked } from '@/db/read/subqueries/liveVersion'
import { selectInBatches } from '@/db/sqlParamBatches'
import { isValidEasAttestationUid } from '@seedprotocol/eas'
import { latestVersionOrder } from '@/db/read/subqueries/latestVersion'

export type PublishedVersionSummary = { uid: string; localId: string | null }

/**
 * One round-trip for list views: for each seed, the same row as {@link getLatestPublishedVersionRow}
 * (first by `LATEST_VERSION_ORDER_SQL` whose `uid` is a valid EAS attestation id and that isn't
 * revoked).
 */
export async function batchLatestPublishedVersionBySeedLocalIds(
  seedLocalIds: string[],
): Promise<Map<string, PublishedVersionSummary>> {
  const out = new Map<string, PublishedVersionSummary>()
  if (seedLocalIds.length === 0) return out
  const appDb = BaseDb.getAppDb()
  if (!appDb) return out

  type Row = {
    seedLocalId: string | null
    localId: string | null
    uid: string | null
    revokedAt: number | null
  }
  const rows: Row[] = await selectInBatches(seedLocalIds, (chunk) =>
    appDb
      .select({
        seedLocalId: versions.seedLocalId,
        localId: versions.localId,
        uid: versions.uid,
        revokedAt: versions.revokedAt,
      })
      .from(versions)
      .where(inArray(versions.seedLocalId, chunk))
      .orderBy(latestVersionOrder()),
  )

  const bySeed = new Map<string, typeof rows>()
  for (const r of rows) {
    const sid = r.seedLocalId
    if (!sid) continue
    const list = bySeed.get(sid) ?? []
    list.push(r)
    bySeed.set(sid, list)
  }

  // A seed's rows all come from one chunk, so each list keeps the SQL order.
  for (const [sid, list] of bySeed) {
    const hit = list.find(
      (r) => r.uid && isValidEasAttestationUid(r.uid) && !isVersionRevoked(r.revokedAt),
    )
    if (hit?.uid) {
      out.set(sid, { uid: hit.uid, localId: hit.localId ?? null })
    }
  }

  return out
}

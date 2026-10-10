import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { inArray } from 'drizzle-orm'
import { isVersionRevoked } from '@/db/read/subqueries/liveVersion'
import { selectInBatches } from '@/db/sqlParamBatches'
import { isValidEasAttestationUid } from '@/helpers/easUid'

export type PublishedVersionSummary = { uid: string; localId: string | null }

/**
 * One round-trip for list views: for each seed, the same row as {@link getLatestPublishedVersionRow}
 * (newest `created_at` whose `uid` is a valid EAS attestation id and that isn't revoked).
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
    createdAt: number | null
    revokedAt: number | null
  }
  const rows: Row[] = await selectInBatches(seedLocalIds, (chunk) =>
    appDb
      .select({
        seedLocalId: versions.seedLocalId,
        localId: versions.localId,
        uid: versions.uid,
        createdAt: versions.createdAt,
        revokedAt: versions.revokedAt,
      })
      .from(versions)
      .where(inArray(versions.seedLocalId, chunk)),
  )

  const bySeed = new Map<string, typeof rows>()
  for (const r of rows) {
    const sid = r.seedLocalId
    if (!sid) continue
    const list = bySeed.get(sid) ?? []
    list.push(r)
    bySeed.set(sid, list)
  }

  for (const [sid, list] of bySeed) {
    const sorted = [...list].sort((a, b) => {
      const ca = a.createdAt ?? 0
      const cb = b.createdAt ?? 0
      if (cb !== ca) return cb - ca
      return String(b.localId ?? '').localeCompare(String(a.localId ?? ''))
    })
    const hit = sorted.find(
      (r) => r.uid && isValidEasAttestationUid(r.uid) && !isVersionRevoked(r.revokedAt),
    )
    if (hit?.uid) {
      out.set(sid, { uid: hit.uid, localId: hit.localId ?? null })
    }
  }

  return out
}

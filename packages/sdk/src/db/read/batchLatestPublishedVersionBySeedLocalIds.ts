import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { inArray } from 'drizzle-orm'
import { isValidEasAttestationUid } from '@/helpers/easUid'

export type PublishedVersionSummary = { uid: string; localId: string | null }

/**
 * One round-trip for list views: for each seed, the same row as {@link getLatestPublishedVersionRow}
 * (newest `created_at` whose `uid` is a valid EAS attestation id).
 */
export async function batchLatestPublishedVersionBySeedLocalIds(
  seedLocalIds: string[],
): Promise<Map<string, PublishedVersionSummary>> {
  const out = new Map<string, PublishedVersionSummary>()
  if (seedLocalIds.length === 0) return out
  const appDb = BaseDb.getAppDb()
  if (!appDb) return out

  const rows = await appDb
    .select({
      seedLocalId: versions.seedLocalId,
      localId: versions.localId,
      uid: versions.uid,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .where(inArray(versions.seedLocalId, seedLocalIds))

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
    const hit = sorted.find((r) => r.uid && isValidEasAttestationUid(r.uid))
    if (hit?.uid) {
      out.set(sid, { uid: hit.uid, localId: hit.localId ?? null })
    }
  }

  return out
}

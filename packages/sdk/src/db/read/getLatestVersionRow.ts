import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { and, desc, eq } from 'drizzle-orm'
import { versionNotRevoked } from '@/db/read/subqueries/liveVersion'

export type LatestVersionRow = {
  localId: string | null
  uid: string | null
  createdAt: number | null
  attestationCreatedAt: number | null
}

/**
 * The seed's head version row: newest by (created_at DESC, local_id DESC), attested or not, skipping
 * revoked versions. Null when the seed has no version or every version is revoked (a fully
 * unpublished item). Same choice as `latestVersionLocalId` in the `getVersionData` subquery.
 */
export async function getLatestVersionRow(seedLocalId: string): Promise<LatestVersionRow | null> {
  const appDb = BaseDb.getAppDb()
  if (!appDb || !seedLocalId) return null

  const rows = await appDb
    .select({
      localId: versions.localId,
      uid: versions.uid,
      createdAt: versions.createdAt,
      attestationCreatedAt: versions.attestationCreatedAt,
    })
    .from(versions)
    .where(and(eq(versions.seedLocalId, seedLocalId), versionNotRevoked()))
    .orderBy(desc(versions.createdAt), desc(versions.localId))
    .limit(1)

  return rows[0] ?? null
}

import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'
import { versionNotRevoked } from '@/db/read/subqueries/liveVersion'
import { latestVersionOrder } from '@/db/read/subqueries/latestVersion'

export type LatestVersionRow = {
  localId: string | null
  uid: string | null
  createdAt: number | null
  attestationCreatedAt: number | null
}

/**
 * The seed's head version row: first by `LATEST_VERSION_ORDER_SQL`, attested or not, skipping
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
    .orderBy(latestVersionOrder())
    .limit(1)

  return rows[0] ?? null
}

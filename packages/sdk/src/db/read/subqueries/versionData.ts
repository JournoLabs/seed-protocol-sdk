import { versions } from '@/seedSchema'
import { and, count, eq, max } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'

/**
 * Per-seed aggregates (all versions) plus the latest version row by
 * (created_at DESC, local_id DESC) via max(created_at) then max(local_id) tie-break.
 *
 * For `publishedVersionUid` / `publishedVersionLocalId` on list rows, see `getItemsData`
 * (batched resolution aligned with `getLatestPublishedVersionRow`).
 */
export const getVersionData = () => {
  const appDb = BaseDb.getAppDb()

  const versionStats = appDb.$with('version_stats').as(
    appDb
      .select({
        seedLocalId: versions.seedLocalId,
        versionsCount: count(versions.localId).as('versionsCount'),
        lastVersionPublishedAt: max(versions.attestationCreatedAt).as(
          'lastVersionPublishedAt',
        ),
        lastLocalUpdateAt: max(versions.createdAt).as('lastLocalUpdateAt'),
        maxCreatedAt: max(versions.createdAt).as('maxCreatedAt'),
      })
      .from(versions)
      .groupBy(versions.seedLocalId),
  )

  const latestVersionIds = appDb.$with('latest_version_ids').as(
    appDb
      .with(versionStats)
      .select({
        seedLocalId: versions.seedLocalId,
        latestVersionLocalId: max(versions.localId).as('latestVersionLocalId'),
      })
      .from(versions)
      .innerJoin(
        versionStats,
        and(
          eq(versions.seedLocalId, versionStats.seedLocalId),
          eq(versions.createdAt, versionStats.maxCreatedAt),
        ),
      )
      .groupBy(versions.seedLocalId),
  )

  return appDb.$with('versionData').as(
    appDb
      .with(versionStats, latestVersionIds)
      .select({
        seedLocalId: versionStats.seedLocalId,
        seedUid: versions.seedUid,
        latestVersionUid: versions.uid,
        latestVersionLocalId: latestVersionIds.latestVersionLocalId,
        versionsCount: versionStats.versionsCount,
        lastVersionPublishedAt: versionStats.lastVersionPublishedAt,
        lastLocalUpdateAt: versionStats.lastLocalUpdateAt,
      })
      .from(versionStats)
      .innerJoin(
        latestVersionIds,
        eq(versionStats.seedLocalId, latestVersionIds.seedLocalId),
      )
      .innerJoin(
        versions,
        and(
          eq(versions.seedLocalId, latestVersionIds.seedLocalId),
          eq(versions.localId, latestVersionIds.latestVersionLocalId),
        ),
      ),
  )
}

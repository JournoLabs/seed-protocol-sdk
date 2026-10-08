import { versions } from '@/seedSchema'
import { and, count, eq, max } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { versionNotRevoked } from './liveVersion'

/**
 * Per-seed version aggregates plus the latest version row by (created_at DESC, local_id DESC) via
 * max(created_at) then max(local_id) tie-break.
 *
 * Revoked versions (`revoked_at` set) are never the latest version and don't count toward
 * `lastVersionPublishedAt`. `versionsCount` and `lastLocalUpdateAt` still cover every version row,
 * so a fully unpublished seed (every version revoked) keeps its row here, with null
 * `latestVersionUid` / `latestVersionLocalId` / `lastVersionPublishedAt`.
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
        lastLocalUpdateAt: max(versions.createdAt).as('lastLocalUpdateAt'),
      })
      .from(versions)
      .groupBy(versions.seedLocalId),
  )

  const liveVersionStats = appDb.$with('live_version_stats').as(
    appDb
      .select({
        seedLocalId: versions.seedLocalId,
        lastVersionPublishedAt: max(versions.attestationCreatedAt).as(
          'lastVersionPublishedAt',
        ),
        maxCreatedAt: max(versions.createdAt).as('maxCreatedAt'),
      })
      .from(versions)
      .where(versionNotRevoked())
      .groupBy(versions.seedLocalId),
  )

  const latestVersionIds = appDb.$with('latest_version_ids').as(
    appDb
      .with(liveVersionStats)
      .select({
        seedLocalId: versions.seedLocalId,
        latestVersionLocalId: max(versions.localId).as('latestVersionLocalId'),
      })
      .from(versions)
      .innerJoin(
        liveVersionStats,
        and(
          eq(versions.seedLocalId, liveVersionStats.seedLocalId),
          eq(versions.createdAt, liveVersionStats.maxCreatedAt),
        ),
      )
      .where(versionNotRevoked())
      .groupBy(versions.seedLocalId),
  )

  return appDb.$with('versionData').as(
    appDb
      .with(versionStats, liveVersionStats, latestVersionIds)
      .select({
        seedLocalId: versionStats.seedLocalId,
        seedUid: versions.seedUid,
        latestVersionUid: versions.uid,
        latestVersionLocalId: latestVersionIds.latestVersionLocalId,
        versionsCount: versionStats.versionsCount,
        lastVersionPublishedAt: liveVersionStats.lastVersionPublishedAt,
        lastLocalUpdateAt: versionStats.lastLocalUpdateAt,
      })
      .from(versionStats)
      .leftJoin(liveVersionStats, eq(versionStats.seedLocalId, liveVersionStats.seedLocalId))
      .leftJoin(latestVersionIds, eq(versionStats.seedLocalId, latestVersionIds.seedLocalId))
      .leftJoin(
        versions,
        and(
          eq(versions.seedLocalId, latestVersionIds.seedLocalId),
          eq(versions.localId, latestVersionIds.latestVersionLocalId),
        ),
      ),
  )
}

import { versions } from '@/seedSchema'
import { and, count, eq, max, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { versionNotRevoked } from './liveVersion'
import { LATEST_VERSION_ORDER_SQL } from './latestVersion'

/**
 * Per-seed version aggregates plus the latest version row: the first live version by
 * `LATEST_VERSION_ORDER_SQL`.
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
      })
      .from(versions)
      .where(versionNotRevoked())
      .groupBy(versions.seedLocalId),
  )

  const rankedLiveVersions = appDb.$with('ranked_live_versions').as(
    appDb
      .select({
        seedLocalId: versions.seedLocalId,
        latestVersionLocalId: sql<string>`${versions.localId}`.as('latestVersionLocalId'),
        rowNum: sql
          .raw(`ROW_NUMBER() OVER (PARTITION BY seed_local_id ORDER BY ${LATEST_VERSION_ORDER_SQL})`)
          .as('rowNum'),
      })
      .from(versions)
      .where(versionNotRevoked()),
  )

  return appDb.$with('versionData').as(
    appDb
      .with(versionStats, liveVersionStats, rankedLiveVersions)
      .select({
        seedLocalId: versionStats.seedLocalId,
        seedUid: versions.seedUid,
        latestVersionUid: versions.uid,
        latestVersionLocalId: rankedLiveVersions.latestVersionLocalId,
        versionsCount: versionStats.versionsCount,
        lastVersionPublishedAt: liveVersionStats.lastVersionPublishedAt,
        lastLocalUpdateAt: versionStats.lastLocalUpdateAt,
      })
      .from(versionStats)
      .leftJoin(liveVersionStats, eq(versionStats.seedLocalId, liveVersionStats.seedLocalId))
      .leftJoin(
        rankedLiveVersions,
        and(
          eq(versionStats.seedLocalId, rankedLiveVersions.seedLocalId),
          eq(rankedLiveVersions.rowNum, 1),
        ),
      )
      .leftJoin(
        versions,
        and(
          eq(versions.seedLocalId, rankedLiveVersions.seedLocalId),
          eq(versions.localId, rankedLiveVersions.latestVersionLocalId),
        ),
      ),
  )
}

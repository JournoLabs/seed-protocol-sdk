import { versions } from '@/shared/seedSchema'
import { count, max } from 'drizzle-orm'
import { getAppDb } from '@/browser/db/sqlWasmClient'

export const getVersionData = () => {
  const appDb = getAppDb()

  return appDb.$with('versionData').as(
    appDb
      .select({
        seedLocalId: versions.seedLocalId,
        seedUid: versions.seedUid,
        latestVersionUid: versions.uid,
        latestVersionLocalId: versions.localId,
        versionsCount: count(versions.localId).as('versionsCount'),
        lastVersionPublishedAt: max(versions.attestationCreatedAt).as(
          'lastVersionPublishedAt',
        ),
        lastLocalUpdateAt: max(versions.createdAt).as('lastLocalUpdateAt'),
      })
      .from(versions)
      .groupBy(versions.seedLocalId),
  )
}

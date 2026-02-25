import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { inArray } from 'drizzle-orm'

type VersionData = {
  localId: string
  uid: string
  seedUid: string
  seedLocalId: string
}
type GetVersionsForVersionUids = (
  versionUids: string[],
) => Promise<VersionData[]>
export const getVersionsForVersionUids: GetVersionsForVersionUids = async (
  versionUids: string[],
) => {
  if (!versionUids || versionUids.length === 0) {
    return []
  }

  const appDb = BaseDb.getAppDb()

  const rows = await appDb
    .select({
      localId: versions.localId,
      uid: versions.uid,
      seedUid: versions.seedUid,
      seedLocalId: versions.seedLocalId,
    })
    .from(versions)
    .where(inArray(versions.uid, versionUids))

  if (!rows || rows.length === 0) {
    return []
  }

  const versionsData: VersionData[] = rows.map((row: { localId: string | null; uid: string | null; seedUid: string | null; seedLocalId: string | null }) => ({
    localId: row.localId || '',
    uid: row.uid || '',
    seedUid: row.seedUid || '',
    seedLocalId: row.seedLocalId || '',
  }))

  return versionsData
}

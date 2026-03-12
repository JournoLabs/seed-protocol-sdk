import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'

type VersionRow = {
  uid: string | null
  seedUid: string | null
}

export const getVersionsForSeedUid = async (
  seedUid: string,
): Promise<{ uid: string }[]> => {
  if (!seedUid) return []

  const appDb = BaseDb.getAppDb()
  const rows = (await appDb
    .select({ uid: versions.uid, seedUid: versions.seedUid })
    .from(versions)
    .where(eq(versions.seedUid, seedUid))) as VersionRow[]

  return rows
    .filter((r) => r.uid && r.uid !== '0x' + '0'.repeat(64))
    .map((r) => ({ uid: r.uid! }))
}

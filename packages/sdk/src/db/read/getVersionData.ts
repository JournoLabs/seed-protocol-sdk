import { versions, VersionsType } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '../Db/BaseDb'

type GetVersionDataProps = {
  localId?: string | null
  uid?: string
  seedLocalId?: string
}

type GetVersionData = (
  props: GetVersionDataProps,
  /** The database or transaction to read; the app database by default. */
  db?: ReturnType<typeof BaseDb.getAppDb>,
) => Promise<VersionsType | undefined>

export const getVersionData: GetVersionData = async (
  {
    localId,
    seedLocalId,
    uid,
  },
  db = BaseDb.getAppDb(),
) => {
  const appDb = db

  const whereClauses = []

  if (seedLocalId) {
    whereClauses.push(eq(versions.seedLocalId, seedLocalId))
  }

  if (localId) {
    whereClauses.push(eq(versions.localId, localId))
  }

  if (uid) {
    whereClauses.push(eq(versions.uid, uid))
  }

  const queryRows = await appDb
    .select()
    .from(versions)
    .where(and(...whereClauses))

  if (!queryRows || !queryRows.length) {
    return
  }

  return queryRows[0]
}

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
) => Promise<VersionsType | undefined>

export const getVersionData: GetVersionData = async ({
  localId,
  seedLocalId,
  uid,
}) => {
  const appDb = BaseDb.getAppDb()

  const whereClauses = []

  if (seedLocalId) {
    whereClauses.push(eq(versions.localId, seedLocalId))
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

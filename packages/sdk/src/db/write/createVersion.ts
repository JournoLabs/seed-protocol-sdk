import { generateId } from '@/helpers'
import { versions } from '@/seedSchema'
import { BaseDb } from '../Db/BaseDb'
import { getSeedPublisher } from '@/db/read/getSeedPublisher'

type CreateVersionProps = {
  seedLocalId?: string
  seedUid?: string
  seedType?: string
  uid?: string
}
type CreateVersion = (
  props: CreateVersionProps,
  options?: {
    /** The database or transaction to write and read; the app database by default. */
    db?: ReturnType<typeof BaseDb.getAppDb>
  },
) => Promise<string>

export const createVersion: CreateVersion = async ({
  seedLocalId,
  seedUid,
  seedType,
  uid,
}, options = {}) => {
  const appDb = options.db ?? BaseDb.getAppDb()

  const newVersionLocalId = generateId()

  // A version belongs to its seed's wallet (none yet for a draft made with no wallet connected).
  const publisher = await getSeedPublisher(seedLocalId, appDb)

  await appDb.insert(versions).values({
    localId: newVersionLocalId,
    createdAt: Date.now(),
    seedLocalId,
    seedUid: seedUid ?? null,
    seedType,
    uid: uid ?? null,
    ...(publisher && { publisher }),
  })

  return newVersionLocalId
}

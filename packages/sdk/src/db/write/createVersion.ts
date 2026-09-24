import { generateId } from '@/helpers'
import { versions } from '@/seedSchema'
import { BaseDb } from '../Db/BaseDb'
import { getPublisherForNewSeedsWithTimeout } from '@/helpers/publishConfig'
import { normalizePublisher } from '@/helpers/addresses'

type CreateVersionProps = {
  seedLocalId?: string
  seedUid?: string
  seedType?: string
  uid?: string
}
type CreateVersion = (props: CreateVersionProps) => Promise<string>

export const createVersion: CreateVersion = async ({
  seedLocalId,
  seedUid,
  seedType,
  uid,
}) => {
  const appDb = BaseDb.getAppDb()

  const newVersionLocalId = generateId()

  const publisher = normalizePublisher(await getPublisherForNewSeedsWithTimeout())

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

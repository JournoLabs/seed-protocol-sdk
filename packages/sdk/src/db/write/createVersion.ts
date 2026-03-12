import { generateId } from '@/helpers'
import { versions } from '@/seedSchema'
import { BaseDb } from '../Db/BaseDb'
import { getGetPublisherForNewSeeds } from '@/helpers/publishConfig'

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

  let publisher: string | undefined
  const getPublisher = getGetPublisherForNewSeeds()
  if (getPublisher) {
    try {
      publisher = await getPublisher()
    } catch {
      // User not connected or getter failed - leave publisher null
    }
  }

  await appDb.insert(versions).values({
    localId: newVersionLocalId,
    createdAt: Date.now(),
    seedLocalId,
    seedUid: seedUid ?? 'NULL',
    seedType,
    uid: uid || 'NULL',
    ...(publisher != null && publisher !== '' && { publisher }),
  })

  return newVersionLocalId
}

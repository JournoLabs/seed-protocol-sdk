import { generateId } from '@/helpers'
import { seeds } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { getGetPublisherForNewSeeds } from '@/helpers/publishConfig'

type CreateSeedProps = {
  type: string
  seedUid?: string
}

export const createSeed = async ({ type, seedUid }: CreateSeedProps): Promise<string> => {
  const schemaUid = await getEasSchemaUidForModel(type)

  // schemaUid is optional - Items can be created without a schemaUid
  // if the EAS schema hasn't been published yet

  const appDb = BaseDb.getAppDb()

  const newSeedLocalId = generateId()

  let publisher: string | undefined
  const getPublisher = getGetPublisherForNewSeeds()
  if (getPublisher) {
    try {
      publisher = await getPublisher()
    } catch {
      // User not connected or getter failed - leave publisher null
    }
  }

  await appDb.insert(seeds).values({
    localId: newSeedLocalId,
    type,
    uid: seedUid,
    createdAt: Date.now(),
    schemaUid: schemaUid || null,
    ...(publisher != null && publisher !== '' && { publisher }),
  })

  return newSeedLocalId
} 
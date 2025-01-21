import { generateId } from '@/helpers'
import { seeds } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { getSchemaUidForModel } from '@/db/read/getSchemaUidForModel'

type CreateSeedProps = {
  type: string
  seedUid?: string
}

export const createSeed = async ({ type, seedUid }: CreateSeedProps): Promise<string> => {
  const schemaUid = await getSchemaUidForModel(type)

  if (!schemaUid) {
    throw new Error(`No schema found for model type: ${type}`)
  }

  const appDb = BaseDb.getAppDb()

  const newSeedLocalId = generateId()

  await appDb.insert(seeds).values({
    localId: newSeedLocalId,
    type,
    uid: seedUid,
    createdAt: Date.now(),
    schemaUid,
  })

  return newSeedLocalId
} 
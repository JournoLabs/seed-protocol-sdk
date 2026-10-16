import { generateId } from '@/helpers'
import { seeds } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { getEasSchemaUidForModel } from '@/db/read/getSchemaUidForModel'
import { getPublisherForNewSeedsWithTimeout } from '@/helpers/publishConfig'
import { normalizePublisher } from '@/helpers/addresses'
import { getOwnedAddressesFromDb } from '@/helpers/db'

type CreateSeedProps = {
  type: string
  seedUid?: string
  modelFileId?: string
}

export const createSeed = async ({ type, seedUid, modelFileId }: CreateSeedProps): Promise<string> => {
  const schemaUid = await getEasSchemaUidForModel(type)

  // schemaUid is optional - Items can be created without a schemaUid
  // if the EAS schema hasn't been published yet

  const appDb = BaseDb.getAppDb()

  const newSeedLocalId = generateId()

  // When nothing supplies a publisher (no getter, as in Node scripts, or no wallet connected yet)
  // and exactly one owned address is set, the draft is that address's. With several, which one would
  // publish isn't known: the draft gets none, stays editable, and the next wallet to connect claims it.
  let publisher = normalizePublisher(await getPublisherForNewSeedsWithTimeout())
  if (!publisher) {
    const owned = await getOwnedAddressesFromDb()
    if (owned.length === 1) publisher = normalizePublisher(owned[0])
  }

  await appDb.insert(seeds).values({
    localId: newSeedLocalId,
    type,
    modelFileId: modelFileId ?? null,
    uid: seedUid,
    createdAt: Date.now(),
    schemaUid: schemaUid || null,
    ...(publisher && { publisher }),
  })

  return newSeedLocalId
} 
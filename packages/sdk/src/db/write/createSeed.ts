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

  // Without a publisher a draft is read-only once owned addresses are set (isSeedRowOwned). So
  // when nothing supplies one (no getter, as in Node scripts, or no wallet connected yet) and
  // exactly one owned address is set, the draft is that address's. With several, which one would
  // publish isn't known: register a getter with setGetPublisherForNewSeeds.
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
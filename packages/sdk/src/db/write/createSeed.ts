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

/** The fields of a new seed row that come from EAS and the app rather than the database. */
export type NewSeedFields = {
  schemaUid: string | null
  publisher: string | undefined
}

/**
 * Resolves a new seed's schema uid (optional: an item can be created before its model's EAS schema
 * is published) and publisher. May call EAS and the app's publisher getter, so run it before a
 * transaction, not inside one.
 */
export const resolveNewSeedFields = async (type: string): Promise<NewSeedFields> => {
  const schemaUid = await getEasSchemaUidForModel(type)

  // When nothing supplies a publisher (no getter, as in Node scripts, or no wallet connected yet)
  // and exactly one owned address is set, the draft is that address's. With several, which one would
  // publish isn't known: the draft gets none, stays editable, and the next wallet to connect claims it.
  let publisher = normalizePublisher(await getPublisherForNewSeedsWithTimeout())
  if (!publisher) {
    const owned = await getOwnedAddressesFromDb()
    if (owned.length === 1) publisher = normalizePublisher(owned[0])
  }
  return { schemaUid: schemaUid || null, publisher: publisher || undefined }
}

export const createSeed = async (
  { type, seedUid, modelFileId }: CreateSeedProps,
  options: {
    /** The database or transaction to write; the app database by default. */
    db?: ReturnType<typeof BaseDb.getAppDb>
    /** From resolveNewSeedFields; required with a transaction's `db`, which mustn't wait on EAS. */
    fields?: NewSeedFields
    /** The new seed's local id, when the caller needs it before the row exists; generated otherwise. */
    localId?: string
  } = {},
): Promise<string> => {
  if (options.db && !options.fields) {
    throw new Error('createSeed: pass fields (resolveNewSeedFields) when writing to a given db')
  }
  const { schemaUid, publisher } = options.fields ?? (await resolveNewSeedFields(type))

  const appDb = options.db ?? BaseDb.getAppDb()

  const newSeedLocalId = options.localId ?? generateId()

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
import { getAppDb } from '../sqlWasmClient'
import { generateId } from '@/shared/helpers'
import { versions } from '@/shared/seedSchema'

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
  const appDb = getAppDb()

  const newVersionLocalId = generateId()

  await appDb.insert(versions).values({
    localId: newVersionLocalId,
    createdAt: Date.now(),
    seedLocalId,
    seedUid: seedUid ?? 'NULL',
    seedType,
    uid: uid || 'NULL',
  })

  return newVersionLocalId
}

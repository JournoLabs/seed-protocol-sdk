import { BaseDb } from '@/db/Db/BaseDb'
import { and, eq, SQL } from 'drizzle-orm'
import { metadata, MetadataType } from '@/seedSchema'

type GetMetadataProps =
  | {
    storageTransactionId?: string
  }
  | undefined

type GetMetadata = (
  props: GetMetadataProps,
) => Promise<MetadataType | undefined>

export const getMetadata: GetMetadata = async (props) => {
  const appDb = BaseDb.getAppDb()

  let storageTransactionId: string | undefined
  if (props) {
    storageTransactionId = props.storageTransactionId
  }

  const whereClauses: SQL[] = []

  if (storageTransactionId) {
    whereClauses.push(eq(metadata.propertyName, 'storageTransactionId'))
    whereClauses.push(eq(metadata.propertyValue, storageTransactionId))
  }

  const metadataRows = await appDb
    .select()
    .from(metadata)
    .where(and(...whereClauses))

  if (!metadataRows || metadataRows.length === 0) {
    return
  }

  return metadataRows[0]
}

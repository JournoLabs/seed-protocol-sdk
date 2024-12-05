import { getAppDb } from '@/browser/db/sqlWasmClient'
import { metadata, MetadataType } from '@/shared/seedSchema'
import { and, eq, getTableColumns } from 'drizzle-orm'

type GetItemPropertyProps = Partial<MetadataType>

type GetItemPropertyData = (
  props: GetItemPropertyProps,
) => Promise<Partial<MetadataType>>

export const getItemPropertyData: GetItemPropertyData = async (props) => {
  const appDb = getAppDb()

  const whereClauses = []

  const tableColumns = getTableColumns(metadata)

  for (const [propertyName, propertyValue] of Object.entries(props)) {
    if (Object.keys(tableColumns).includes(propertyName)) {
      whereClauses.push(eq(tableColumns[propertyName], propertyValue))
    }
  }

  const queryRows = await appDb
    .select()
    .from(metadata)
    .where(and(...whereClauses))

  if (!queryRows || queryRows.length === 0) {
    return
  }

  return queryRows[0]
}

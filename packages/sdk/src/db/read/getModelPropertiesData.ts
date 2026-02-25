import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'

export type ModelPropertyDataRow = {
  id: number
  name: string
  dataType: string
  modelId: number
  refModelId: number | null
  refValueType: string | null
  schemaFileId: string | null
  isEdited: number | null
}

type GetModelPropertiesData = (
  modelFileId: string,
) => Promise<ModelPropertyDataRow[]>

/**
 * Returns property rows for a model identified by modelFileId (model's schemaFileId).
 * Resolves modelFileId -> modelId via models table, then selects all properties where modelId = ?.
 * Each row includes schemaFileId for use with ModelProperty.createById(schemaFileId).
 */
export const getModelPropertiesData: GetModelPropertiesData = async (
  modelFileId: string,
): Promise<ModelPropertyDataRow[]> => {
  const appDb = BaseDb.getAppDb()
  if (!appDb || !modelFileId) {
    return []
  }

  const modelRows = await appDb
    .select({ id: modelsTable.id })
    .from(modelsTable)
    .where(eq(modelsTable.schemaFileId, modelFileId))
    .limit(1)

  if (modelRows.length === 0) {
    return []
  }

  const modelId = modelRows[0].id

  const rows = await appDb
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.modelId, modelId))

  return rows as ModelPropertyDataRow[]
}

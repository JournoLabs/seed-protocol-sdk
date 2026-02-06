import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq, or } from 'drizzle-orm'

export type ModelsDataRow = {
  id: number
  name: string
  schemaFileId: string | null
  isEdited: number | null
}

type GetModelsData = (schemaIdentifier?: string) => Promise<ModelsDataRow[]>

/**
 * Returns model rows (id, name, schemaFileId, isEdited) for building Model instances.
 * When schemaIdentifier is provided, only returns models for that schema (join models -> model_schemas -> schemas).
 * schemaIdentifier can be either schema name or schema file ID.
 */
export const getModelsData: GetModelsData = async (
  schemaIdentifier?: string,
): Promise<ModelsDataRow[]> => {
  const appDb = BaseDb.getAppDb()
  if (!appDb) {
    return []
  }

  if (schemaIdentifier !== undefined && schemaIdentifier !== '') {
    const rows = await appDb
      .select({
        id: modelsTable.id,
        name: modelsTable.name,
        schemaFileId: modelsTable.schemaFileId,
        isEdited: modelsTable.isEdited,
      })
      .from(modelsTable)
      .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
      .where(
        or(
          eq(schemasTable.name, schemaIdentifier),
          eq(schemasTable.schemaFileId, schemaIdentifier),
        ),
      )

    return rows as ModelsDataRow[]
  }

  const rows = await appDb
    .select({
      id: modelsTable.id,
      name: modelsTable.name,
      schemaFileId: modelsTable.schemaFileId,
      isEdited: modelsTable.isEdited,
    })
    .from(modelsTable)

  return rows as ModelsDataRow[]
}

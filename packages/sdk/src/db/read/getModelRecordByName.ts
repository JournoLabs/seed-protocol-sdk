import { and, eq, isNull } from 'drizzle-orm'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'

export type ModelRecordByName = typeof modelsTable.$inferSelect

/**
 * `models` rows with this name that may belong to `schemaName`: rows linked to the schema (any
 * version) through `model_schemas` first, then stub rows not linked to any schema and without a
 * schemaFileId (e.g. inserted by name for config models, to be adopted by a schema import). Rows that
 * belong only to other schemas are left out: model names are unique per schema, not globally, so a
 * lookup by name alone can pick up another schema's same-named model. So are unlinked rows with a
 * schemaFileId: those are models of another schema whose link was removed, not stubs.
 */
export async function getModelRecordsByName(
  db: any,
  modelName: string,
  schemaName: string,
): Promise<ModelRecordByName[]> {
  const linked: { model: ModelRecordByName }[] = await db
    .selectDistinct({ model: modelsTable })
    .from(modelsTable)
    .innerJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
    .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
    .where(and(eq(modelsTable.name, modelName), eq(schemasTable.name, schemaName)))
  const unlinked: { model: ModelRecordByName }[] = await db
    .select({ model: modelsTable })
    .from(modelsTable)
    .leftJoin(modelSchemas, eq(modelsTable.id, modelSchemas.modelId))
    .where(and(eq(modelsTable.name, modelName), isNull(modelSchemas.id), isNull(modelsTable.schemaFileId)))
  return [...linked, ...unlinked].map(({ model }) => model)
}

/** First of {@link getModelRecordsByName}: the schema's own model if linked, else an unlinked stub. */
export async function getModelRecordByName(
  db: any,
  modelName: string,
  schemaName: string,
): Promise<ModelRecordByName | undefined> {
  return (await getModelRecordsByName(db, modelName, schemaName))[0]
}

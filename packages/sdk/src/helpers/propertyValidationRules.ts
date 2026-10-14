import { eq } from 'drizzle-orm'
import type { ValidationRules } from '@/Schema/validation'

/**
 * A property's validation rules (enum, pattern, minLength, maxLength). The properties table has
 * no column for them, so they come from the loaded schema or ModelProperty instance
 * (getPropertySchema) or, when that isn't loaded yet, from the schema data stored with the
 * model's schema row.
 */
export async function resolvePropertyValidationRules(
  modelName: string,
  propertyName: string,
  scope: { modelFileId?: string | null; schemaName?: string | null } = {},
): Promise<ValidationRules | undefined> {
  const { getPropertySchema } = await import('./property')
  const fromSchema = await getPropertySchema(modelName, propertyName, scope).catch(() => undefined)
  if (fromSchema?.validation) return fromSchema.validation as ValidationRules

  const { BaseDb } = await import('../db/Db/BaseDb')
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  try {
    const { resolveModelRecord } = await import('../db/read/resolveModelRecord')
    const modelRecord = await resolveModelRecord(modelName, scope, db)
    if (!modelRecord?.id) return undefined
    const { schemas: schemasTable } = await import('../seedSchema/SchemaSchema')
    const { modelSchemas } = await import('../seedSchema/ModelSchemaSchema')
    const rows = await db
      .select({ schemaData: schemasTable.schemaData })
      .from(modelSchemas)
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
      .where(eq(modelSchemas.modelId, modelRecord.id))
      .limit(1)
    const schemaData = rows[0]?.schemaData
    if (!schemaData) return undefined
    const parsed = JSON.parse(schemaData) as {
      models?: Record<string, { properties?: Record<string, { validation?: ValidationRules }> }>
    }
    return parsed?.models?.[modelName]?.properties?.[propertyName]?.validation
  } catch {
    return undefined
  }
}

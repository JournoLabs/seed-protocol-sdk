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
  const rules = await resolveModelValidationRules(modelName, [propertyName], scope)
  return rules.get(propertyName)
}

/**
 * resolvePropertyValidationRules for several properties of one model. The stored schema data is
 * read and parsed once for all the properties the loaded schema has no rules for.
 */
export async function resolveModelValidationRules(
  modelName: string,
  propertyNames: string[],
  scope: { modelFileId?: string | null; schemaName?: string | null } = {},
): Promise<Map<string, ValidationRules>> {
  const rules = new Map<string, ValidationRules>()
  const { getPropertySchema } = await import('./property')
  const missing: string[] = []
  const fromSchemas = await Promise.all(
    propertyNames.map((propertyName) => getPropertySchema(modelName, propertyName, scope).catch(() => undefined)),
  )
  propertyNames.forEach((propertyName, i) => {
    const validation = fromSchemas[i]?.validation
    if (validation) rules.set(propertyName, validation as ValidationRules)
    else missing.push(propertyName)
  })
  if (missing.length === 0) return rules

  const { BaseDb } = await import('../db/Db/BaseDb')
  const db = BaseDb.getAppDb()
  if (!db) return rules
  try {
    const { resolveModelRecord } = await import('../db/read/resolveModelRecord')
    const modelRecord = await resolveModelRecord(modelName, scope, db)
    if (!modelRecord?.id) return rules
    const { schemas: schemasTable } = await import('../seedSchema/SchemaSchema')
    const { modelSchemas } = await import('../seedSchema/ModelSchemaSchema')
    const rows = await db
      .select({ schemaData: schemasTable.schemaData })
      .from(modelSchemas)
      .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
      .where(eq(modelSchemas.modelId, modelRecord.id))
      .limit(1)
    const schemaData = rows[0]?.schemaData
    if (!schemaData) return rules
    const parsed = JSON.parse(schemaData) as {
      models?: Record<string, { properties?: Record<string, { validation?: ValidationRules }> }>
    }
    for (const propertyName of missing) {
      const validation = parsed?.models?.[modelName]?.properties?.[propertyName]?.validation
      if (validation) rules.set(propertyName, validation)
    }
  } catch {
    // Same as no rules: the property loads without validation
  }
  return rules
}

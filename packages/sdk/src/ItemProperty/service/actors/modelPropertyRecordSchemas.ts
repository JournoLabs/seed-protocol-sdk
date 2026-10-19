import { eq, inArray } from 'drizzle-orm'
import type { BaseDb } from '@/db/Db/BaseDb'
import { models, properties } from '@/seedSchema'
import { resolveModelRecord } from '@/db/read/resolveModelRecord'
import { resolveModelValidationRules } from '@/helpers/propertyValidationRules'
import { timingMarks } from '@/helpers/timing'

type Db = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

export type PropertyRecordSchema = {
  id: number
  dataType: string
  ref?: string
  refValueType?: string
  storageType?: string
  localStorageDir?: string
  filenameSuffix?: string
  required?: boolean
  validation?: unknown
}

/**
 * One read per model while it's in flight: an item's properties load together and would otherwise
 * each look up the same model row, properties and schema data. Nothing is kept once the read
 * settles, so a later load sees schema changes.
 */
const inFlight = new Map<string, Promise<Map<string, PropertyRecordSchema>>>()

/**
 * Every property's record schema for one model, read from the database (properties table, ref
 * model names, validation rules from the schema), keyed by property name. Empty when the model has
 * no row. Rejects when the model can't be resolved (e.g. an ambiguous name).
 */
export function loadModelPropertyRecordSchemas(
  modelName: string,
  modelFileId: string | undefined,
  db: Db,
): Promise<Map<string, PropertyRecordSchema>> {
  const key = JSON.stringify([modelName, modelFileId ?? null])
  const existing = inFlight.get(key)
  if (existing) return existing
  const read = readModelPropertyRecordSchemas(modelName, modelFileId, db)
  inFlight.set(key, read)
  const forget = () => {
    if (inFlight.get(key) === read) inFlight.delete(key)
  }
  read.then(forget, forget)
  return read
}

const readModelPropertyRecordSchemas = async (
  modelName: string,
  modelFileId: string | undefined,
  db: Db,
): Promise<Map<string, PropertyRecordSchema>> => {
  const schemas = new Map<string, PropertyRecordSchema>()
  const timing = timingMarks()
  const modelRecord = await resolveModelRecord(modelName, { modelFileId }, db)
  timing.mark('model record')
  if (!modelRecord?.id) return schemas

  const propertyRecords: (typeof properties.$inferSelect)[] = await db
    .select()
    .from(properties)
    .where(eq(properties.modelId, modelRecord.id))
  // properties has refModelId but not the ref model's name
  const refModelIds = [
    ...new Set(propertyRecords.map((r) => r.refModelId).filter((id): id is number => id != null)),
  ]
  const refModelNames = new Map<number, string>()
  if (refModelIds.length > 0) {
    const refModelRows = await db
      .select({ id: models.id, name: models.name })
      .from(models)
      .where(inArray(models.id, refModelIds))
    for (const row of refModelRows as { id: number; name: string }[]) refModelNames.set(row.id, row.name)
  }
  timing.mark('properties')
  // Validation rules (enum, pattern, ...) aren't in the properties table
  const validationRules = await resolveModelValidationRules(
    modelName,
    propertyRecords.map((r) => r.name),
    { modelFileId: modelRecord.schemaFileId ?? modelFileId },
  )

  timing.mark('validation rules')
  timing.log(`model ${modelName} property schemas`)

  for (const propRecord of propertyRecords) {
    if (schemas.has(propRecord.name)) continue
    const validation = validationRules.get(propRecord.name)
    schemas.set(propRecord.name, {
      id: propRecord.id,
      dataType: propRecord.dataType,
      ref: propRecord.refModelId != null ? refModelNames.get(propRecord.refModelId) : undefined,
      refValueType: propRecord.refValueType || undefined,
      storageType: propRecord.storageType || undefined,
      localStorageDir: propRecord.localStorageDir || undefined,
      filenameSuffix: propRecord.filenameSuffix || undefined,
      required: (propRecord as { required?: boolean }).required ?? undefined,
      ...(validation ? { validation } : {}),
    })
  }
  return schemas
}

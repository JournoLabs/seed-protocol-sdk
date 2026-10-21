import type { BaseDb } from '@/db/Db/BaseDb'
import { getModelPropertyDefinitions } from '@/helpers/property'
import type { PropertyDefinition } from '@/helpers/propertyDefinition'

type Db = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

/**
 * One read per model while it's in flight: an item's properties load together and would otherwise
 * each read the same model's rows. Nothing is kept once the read settles, so a later load sees
 * schema changes.
 */
const inFlight = new Map<string, Promise<Map<string, PropertyDefinition>>>()

/**
 * Every property definition of one model ({@link getModelPropertyDefinitions}), keyed by property
 * name. Empty when the model has no row. Rejects when the model can't be resolved (e.g. an
 * ambiguous name).
 */
export function loadModelPropertyRecordSchemas(
  modelName: string,
  modelFileId: string | undefined,
  db: Db,
): Promise<Map<string, PropertyDefinition>> {
  const key = JSON.stringify([modelName, modelFileId ?? null])
  const existing = inFlight.get(key)
  if (existing) return existing
  const read = getModelPropertyDefinitions(modelName, { modelFileId }, db)
  inFlight.set(key, read)
  const forget = () => {
    if (inFlight.get(key) === read) inFlight.delete(key)
  }
  read.then(forget, forget)
  return read
}

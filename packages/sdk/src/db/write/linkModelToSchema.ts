import { and, eq } from 'drizzle-orm'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'

const pendingLinks = new Map<string, Promise<boolean>>()

/**
 * Insert the link unless it exists, without joining the per-pair queue below. For a transaction
 * (applySchemaFile): queued behind a write that waits for the transaction to end, it would wait
 * forever, and the transaction already serializes its own statements.
 */
export async function insertModelSchemaLink(db: any, modelId: number, schemaId: number): Promise<boolean> {
  const existing = await db
    .select({ id: modelSchemas.id })
    .from(modelSchemas)
    .where(and(eq(modelSchemas.modelId, modelId), eq(modelSchemas.schemaId, schemaId)))
    .limit(1)
  if (existing.length > 0) return false
  await db.insert(modelSchemas).values({ modelId, schemaId })
  return true
}

/**
 * Insert the `model_schemas` row linking a model to a schema, unless it already exists.
 *
 * `model_schemas` has no unique constraint, and several writers link the same model during one
 * import (importJsonSchema's addModelsToDb and the write service's writeModelToDb). Each used to
 * check-then-insert on its own, so concurrent writers inserted the link twice. The check and insert
 * run serialized per (model, schema) here.
 *
 * @returns true when this call inserted the link
 */
export function linkModelToSchema(db: any, modelId: number, schemaId: number): Promise<boolean> {
  const key = `${modelId}:${schemaId}`
  const previous = pendingLinks.get(key) ?? Promise.resolve(false)
  const current = previous
    .catch(() => false)
    .then(() => insertModelSchemaLink(db, modelId, schemaId))
  pendingLinks.set(key, current)
  const cleanup = () => {
    if (pendingLinks.get(key) === current) pendingLinks.delete(key)
  }
  current.then(cleanup, cleanup)
  return current
}

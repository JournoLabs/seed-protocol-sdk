import { sha3_256 } from '@noble/hashes/sha3'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import type { LensSchema } from './lens.js'

/**
 * The id the SDK gives a schema (`deriveSchemaFileId(name)`), model (`(name, model)`) or property
 * (`(name, model, property)`) that its schema file leaves without one: the first 10 hex characters
 * of the SHA3-256 of the names joined with `/`. Kept equal to the SDK's by a test vector in each
 * package; rdf doesn't import the SDK.
 */
export const deriveSchemaId = (...names: string[]): string =>
  bytesToHex(sha3_256(utf8ToBytes(names.join('/')))).slice(0, 10)

/**
 * The schema with the ids its file leaves out filled in as the SDK fills them, so a hand-written
 * `seed.schema.json` without ids reads the same as the file the SDK writes. Needs `metadata.name`;
 * without it the schema is returned as it is. The SDK keeps ids a stored schema already had, so
 * the two differ when an app's file once carried other ids and then dropped them.
 */
export function withSchemaIds<T extends LensSchema>(schema: T): T {
  const name = schema.metadata?.name
  if (!name || !needsIds(schema)) return schema
  const models = Object.fromEntries(
    Object.entries(schema.models).map(([modelName, model]) => [
      modelName,
      {
        ...model,
        id: model.id ?? deriveSchemaId(name, modelName),
        properties: Object.fromEntries(
          Object.entries(model.properties ?? {}).map(([propertyName, property]) => [
            propertyName,
            { ...property, id: property?.id ?? deriveSchemaId(name, modelName, propertyName) },
          ]),
        ),
      },
    ]),
  )
  return { ...schema, id: schema.id ?? deriveSchemaId(name), models }
}

/** Whether the schema, a model or a property has no id. */
export function needsIds(schema: LensSchema): boolean {
  return (
    !schema.id ||
    Object.values(schema.models).some(
      (model) => !model.id || Object.values(model.properties ?? {}).some((property) => !property?.id),
    )
  )
}

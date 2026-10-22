import { writeModelToDb, writePropertyToDb } from '@/helpers/db'
import debug from 'debug'

const logger = debug('seedSdk:db:write:saveDefinition')

export type ModelDefinitionWrite = {
  type: 'model'
  modelFileId: string
  modelName: string
  schemaId: number
  properties?: { [name: string]: any }
}

export type PropertyDefinitionWrite = {
  type: 'property'
  propertyFileId: string
  /** Read when the write starts, so an edit made since the call is what gets written. */
  data: () => Parameters<typeof writePropertyToDb>[1]
}

// Writes that have started. Evicting an instance can't cancel its write, so code that deletes rows
// under live instances (Schema.destroy, test cleanup) waits for these after evicting the instances.
const inFlightWrites = new Set<Promise<unknown>>()

/**
 * Resolves once every definition write started so far has finished (or after timeoutMs). Evict the
 * instances first so no new writes start while waiting.
 */
export const waitForInFlightWrites = async (
  timeoutMs = 5000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (inFlightWrites.size > 0 && Date.now() < deadline) {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled([...inFlightWrites]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, deadline - Date.now())
      }),
    ])
    clearTimeout(timer)
  }
}

const track = <T>(write: Promise<T>): Promise<T> => {
  inFlightWrites.add(write)
  const untrack = () => inFlightWrites.delete(write)
  write.then(untrack, untrack)
  return write
}

/**
 * Writes the definition row of a Model or ModelProperty created at runtime. A model write also
 * stores its link to the schema and the properties given, in one transaction, and returns the
 * model's row id. A property is checked against TProperty first and throws when invalid.
 */
export function saveDefinition(input: ModelDefinitionWrite): Promise<number>
export function saveDefinition(input: PropertyDefinitionWrite): Promise<void>
export function saveDefinition(
  input: ModelDefinitionWrite | PropertyDefinitionWrite,
): Promise<number | void> {
  return track(write(input))
}

const write = async (
  input: ModelDefinitionWrite | PropertyDefinitionWrite,
): Promise<number | void> => {
  if (input.type === 'model') {
    logger(
      `Writing model "${input.modelName}" (${input.modelFileId}) to schema ${input.schemaId}`,
    )
    return writeModelToDb(input.modelFileId, {
      modelName: input.modelName,
      schemaId: input.schemaId,
      properties: input.properties,
    })
  }
  // Imported here: the validation service imports the Schema barrel, which imports this module's callers
  const { SchemaValidationService } =
    await import('@/Schema/service/validation/SchemaValidationService')
  const data = input.data()
  const { errors } = new SchemaValidationService().validatePropertyStructure(
    data as any,
  )
  if (errors.length > 0) {
    throw new Error(
      `Property "${data.name}" is invalid: ${errors.map((error) => error.message).join(', ')}`,
    )
  }
  logger(`Writing property "${data.name}" (${input.propertyFileId})`)
  await writePropertyToDb(input.propertyFileId, data)
}

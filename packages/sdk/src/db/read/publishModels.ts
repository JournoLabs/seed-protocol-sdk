import { resolveModelRecord, type ResolvedModelRecord } from '@/db/read/resolveModelRecord'
import { relatedModelNameFromDef } from '@/db/read/resolveRelatedSeedRef'
import { publishPropertyKind, type PublishGraphProperty } from '@/db/read/publishGraph'
import { getPropertyDefinitions, type PropertyDefinition } from '@/helpers/propertyDefinition'

/** One model as a publish attests it, read from its definitions: what an EAS schema check needs without a seed. */
export type PublishModel = {
  modelName: string
  /** Every property of the model. */
  properties: Pick<PublishGraphProperty, 'key' | 'definition' | 'kind'>[]
}

export type GetPublishModelsOptions = {
  /** The schema that defines `modelNames`. Needed when two schemas define a model of the same name. */
  schemaName?: string
  /** Also the models that relation and list properties name, and theirs in turn. Default true. */
  followRefs?: boolean
}

/** The model a relation, list or storage-seed property names: by its ref's row id, else by name. */
async function refModel(definition: PropertyDefinition, schemaName: string | undefined): Promise<ResolvedModelRecord | undefined> {
  if (definition.refModelId) {
    const model = await resolveModelRecord(undefined, { modelId: definition.refModelId })
    if (model) return model
  }
  const name = relatedModelNameFromDef(definition)
  return name ? resolveModelRecord(name, { schemaName }) : undefined
}

/**
 * The models a publish of items of `modelNames` attests, from the definitions the client loaded:
 * each model, the storage models (Image, File, Html) its storage-seed properties reach, and with
 * `followRefs` the models its relation and list properties name. Each model appears once.
 *
 * Throws for a name with no model (in `schemaName`, when given), and AmbiguousModelError for a
 * name two schemas define when no `schemaName` is given. A ref whose model isn't loaded is skipped.
 */
export async function getPublishModels(
  modelNames: string[],
  options: GetPublishModelsOptions = {},
): Promise<PublishModel[]> {
  const { schemaName, followRefs = true } = options
  const queue: ResolvedModelRecord[] = []
  for (const name of modelNames) {
    const model = await resolveModelRecord(name, { schemaName, strict: !!schemaName })
    if (!model) throw new Error(`No model named ${name}${schemaName ? ` in schema ${schemaName}` : ''}`)
    queue.push(model)
  }

  const seen = new Set<number>()
  const result: PublishModel[] = []
  while (queue.length > 0) {
    const model = queue.shift()!
    if (seen.has(model.id)) continue
    seen.add(model.id)

    const properties: PublishModel['properties'] = []
    for (const [key, definition] of await getPropertyDefinitions(model.id)) {
      const kind = publishPropertyKind(key, definition)
      properties.push({ key, definition, kind })
      if (kind === 'storageSeed' || (followRefs && (kind === 'relation' || kind === 'list'))) {
        const target = await refModel(definition, schemaName)
        if (target && !seen.has(target.id)) queue.push(target)
      }
    }
    result.push({ modelName: model.name, properties })
  }
  return result
}

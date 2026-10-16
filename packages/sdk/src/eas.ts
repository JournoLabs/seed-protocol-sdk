export {
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  getCanonicalItemPropertiesFromEas,
  getEasSchemaUidBySchemaName,
  getSeedsFromSchemaUids,
  getSeedsBySchemaName,
  getSeedUidsBySchemaName,
  getPublishedByFromEas,
  decodePublishedByData,
  hashPublishedByBatch,
  verifyPublishedByBatch,
  PUBLISHED_BY_SCHEMA_DEF,
  PUBLISHED_BY_SCHEMA_NAME,
} from '@seedprotocol/eas'
export type {
  Attestation,
  EASSchema,
  PublishedByDecoded,
  GetPublishedByFromEasParams,
} from '@seedprotocol/eas'

import { easNamesToFetch } from '@seedprotocol/eas'
import { nameMatchLevels } from '@/db/read/nameMatchLevels'
import { withExcludeRevokedFilter } from '@seedprotocol/eas'
import { BaseEasClient } from '@seedprotocol/eas'
import { BaseQueryClient } from '@seedprotocol/eas'
import { GET_SCHEMAS } from '@seedprotocol/eas'
import type { EASSchema } from '@seedprotocol/eas'

type GetModelSchemasFromEas = () => Promise<EASSchema[]>

/** Stays in SDK: depends on local Model registry. */
export const getModelSchemasFromEas: GetModelSchemasFromEas = async () => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

  const modelMod = await import('./Model/Model')
  const { Model } = modelMod
  const allModels = await Model.all()
  const modelNames = allModels.map((m) => m.modelName).filter((name): name is string => !!name)

  if (modelNames.length === 0) {
    return []
  }

  const OR: Record<string, unknown>[] = []
  const hasImageModel = modelNames.includes('Image')

  // ADR 0008/0009: every name an SDK may have published that the model can match at its
  // nameMatch level (at fuzzy: its EAS name, the older simple snake_case, separators dropped, a
  // plural or singular form). The caller matches the results to local models.
  const levels = await nameMatchLevels()
  const schemaNames = new Set<string>()
  for (const modelName of modelNames) {
    for (const name of easNamesToFetch(modelName, levels.model(modelName))) schemaNames.add(name)
  }
  for (const name of schemaNames) {
    OR.push({ schema: { equals: `bytes32 ${name}` } })
  }

  if (hasImageModel) {
    OR.push({
      schema: {
        equals: `bytes32 image`,
      },
    })
  }

  const modelSchemas = await queryClient.fetchQuery({
    queryKey: [`getSchemasAllModels`, [...schemaNames].sort()],
    queryFn: async () =>
      easClient.request(GET_SCHEMAS, {
        where: {
          OR,
        },
      }),
  })

  if (!modelSchemas?.schemas?.length) {
    return []
  }

  return modelSchemas.schemas as EASSchema[]
}

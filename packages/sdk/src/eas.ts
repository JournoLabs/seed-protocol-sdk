export {
  getItemVersionsFromEas,
  getItemPropertiesFromEas,
  getCanonicalItemPropertiesFromEas,
  getEasSchemaUidBySchemaName,
  getSeedsFromSchemaUids,
  getSeedsBySchemaName,
  getSeedUidsBySchemaName,
} from '@seedprotocol/eas'
export type { Attestation, EASSchema } from '@seedprotocol/eas'

import { toSnakeCase } from '@/helpers'
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

  for (const modelName of modelNames) {
    const snake = toSnakeCase(modelName)
    OR.push({
      schema: {
        equals: `bytes32 ${snake}`,
      },
    })
    const altSchema = `bytes32 ${modelName}`
    if (altSchema !== `bytes32 ${snake}`) {
      OR.push({
        schema: {
          equals: altSchema,
        },
      })
    }
  }

  if (hasImageModel) {
    OR.push({
      schema: {
        equals: `bytes32 image`,
      },
    })
  }

  const modelSchemas = await queryClient.fetchQuery({
    queryKey: [`getSchemasAllModels`],
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

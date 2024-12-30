import { easClient, queryClient } from '@/browser/helpers'
import { GET_SCHEMAS } from '@/browser'

export const getSchemaUidForModel = async (
  modelName: string,
): Promise<string> => {
  const modeType = modelName.toLowerCase()

  const modelSchemaQuery = await queryClient.fetchQuery({
    queryKey: [`getPropertySchema${modelName}`],
    queryFn: async () =>
      easClient.request(GET_SCHEMAS, {
        where: {
          schemaNames: {
            some: {
              name: {
                equals: modeType,
              },
            },
          },
        },
      }),
  })

  const foundSchema = modelSchemaQuery.schemas[0]
  return foundSchema.id
}

import { GET_SCHEMAS } from '@/Item/queries'
import { BaseEasClient } from '@/helpers/EasClient/BaseEasClient'
import { BaseQueryClient } from '@/helpers/QueryClient/BaseQueryClient'


export const getSchemaUidForModel = async (
  modelName: string,
): Promise<string> => {
  const queryClient = BaseQueryClient.getQueryClient()
  const easClient = BaseEasClient.getEasClient()

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

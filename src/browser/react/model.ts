import { useSelector }         from '@xstate/react'
import { ModelClassType } from '@/types'
import { getClient } from '@/client/ClientManager'
import { SeedModels } from '@/helpers/constants'

const seedModels = Object.values(SeedModels)

export const useModels = () => {

  const client = getClient()

  const clientService = client.getService()
  
  const models = useSelector(clientService, (snapshot) => {
    if (snapshot && snapshot.context && snapshot.context.models) {
      const externalModelDefinitions = Object.entries(snapshot.context.models).filter(([key]) => !seedModels.includes(key as SeedModels))
      return Object.fromEntries(externalModelDefinitions) as { [key: string]: ModelClassType }
    }
    return {}
  })

  return {
    models,
  }
}

export const useModel = (modelName: string | undefined) => {
  const { models } = useModels()

  if (!modelName) {
    return undefined
  }

  return models[modelName]
}
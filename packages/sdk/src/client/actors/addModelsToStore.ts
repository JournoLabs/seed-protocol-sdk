import { EventObject, fromCallback } from 'xstate'
import { ClientManagerContext, FromCallbackInput } from '@/types/machines'
import { ClientManagerEvents } from '@/client/constants'
import debug from 'debug'

const logger = debug('seedSdk:client:actors:addModelsToStore')

export const addModelsToStore = fromCallback<
  EventObject,
  FromCallbackInput<ClientManagerContext>
>(({ sendBack, input: { context } }) => {

  const _addModelsToStore = async () => {
    let { models } = context
    if (!models) {
      models = {}
    }

    // Internal models (Seed, Version, Metadata, Image) are now loaded via SEEDPROTOCOL_Seed_Protocol_v1.json schema
    // They should already be in context.models from processSchemaFiles
    const allModels = { ...models }
    
    sendBack({ type: ClientManagerEvents.UPDATE_CONTEXT, context: { models: allModels } })
    
    // Models are now Model instances, no registration needed
    // They should be created via Model.create() and are accessible via Model static methods
    for (const [key] of Object.entries(allModels)) {
      logger('model available:', key)
    }

  }

  _addModelsToStore().then(() => {
    sendBack({ type: ClientManagerEvents.ADD_MODELS_TO_STORE_SUCCESS })
  })
})
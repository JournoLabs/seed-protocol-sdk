import { EventObject, fromCallback } from 'xstate'
import { ClientManagerContext, FromCallbackInput } from '@/types/machines'
import { ClientManagerEvents } from '@/services/internal/constants'
import { setModel } from '@/stores/modelClass'
import { ModelClassType } from '@/types'
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

    // Internal models (Seed, Version, Metadata, Image) are now loaded via seed-protocol-v1.json schema
    // They should already be in context.models from processSchemaFiles
    const allModels = { ...models }
    
    sendBack({ type: ClientManagerEvents.UPDATE_CONTEXT, context: { models: allModels } })
    
    for (const [key, value] of Object.entries(allModels)) {
      logger('setting model:', key)
      setModel(key, value as unknown as ModelClassType)
    }

  }

  _addModelsToStore().then(() => {
    sendBack({ type: ClientManagerEvents.ADD_MODELS_TO_STORE_SUCCESS })
  })
})
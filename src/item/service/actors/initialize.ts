import { EventObject, fromCallback } from 'xstate'
import pluralize from 'pluralize'
import { getExistingItem } from '@/db/read/getExistingItem'
import { FromCallbackInput, ItemMachineContext } from '@/types'

export const initialize = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(
  ({ sendBack, input: { context } }) => {
    const { seedLocalId, seedUid, modelName: contextModelName, ModelClass } = context

    // Prefer modelName from context, fall back to ModelClass if available
    let modelName = contextModelName
    if (!modelName && ModelClass) {
      // If ModelClass is a Model instance, use its modelName property
      modelName = (ModelClass as any)?.modelName || (ModelClass as any)?.originalConstructor?.name
    }
    
    if (!modelName) {
      throw new Error('modelName is required in context')
    }
    const modelNamePlural = pluralize(modelName)
    const modelTableName = modelNamePlural.toLowerCase()

    const _intialize = async (): Promise<void> => {
      const existingItem = await getExistingItem({ seedUid: seedUid || undefined, seedLocalId: seedLocalId || undefined })

      if (existingItem) {
        sendBack({
          type: 'hasExistingItem',
          modelName,
          modelTableName,
          modelNamePlural,
          existingItem,
        })
        return
      }

      sendBack({
        type: 'isNewItem',
        modelName,
        modelTableName,
        modelNamePlural,
      })
    }

    _intialize()
      .then(() => {
        sendBack({ type: 'initializeSuccess' })
      })
      .catch((error) => {
        sendBack({
          type: 'initializeError',
          error: error instanceof Error ? error : new Error(String(error)),
        })
      })
  },
)

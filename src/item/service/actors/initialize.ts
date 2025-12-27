import { EventObject, fromCallback } from 'xstate'
import pluralize from 'pluralize'
import { getExistingItem } from '@/db/read/getExistingItem'
import { FromCallbackInput, ItemMachineContext } from '@/types'

export const initialize = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(
  ({ sendBack, input: { context } }) => {
    const { seedLocalId, seedUid, ModelClass, modelName: contextModelName } = context

    if (!ModelClass) {
      throw new Error('ModelClass is required')
    }

    const modelName = ModelClass?.originalConstructor?.name || contextModelName
    if (!modelName) {
      throw new Error('ModelClass.originalConstructor.name or modelName is required')
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

    _intialize().then(() => {
      sendBack({ type: 'initializeSuccess' })
      return
    })
  },
)

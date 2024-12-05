import { EventObject, fromCallback } from 'xstate'
import { itemMachineSingle } from '@/browser/item/single/itemMachineSingle'
import pluralize from 'pluralize'
import { getExistingItem } from '@/browser/db/read'

export const initialize = fromCallback<EventObject, typeof itemMachineSingle>(
  ({ sendBack, input: { context } }) => {
    const { seedLocalId, seedUid, ModelClass } = context

    const modelName = ModelClass.originalConstructor.name
    const modelNamePlural = pluralize(modelName)
    const modelTableName = modelNamePlural.toLowerCase()

    const _intialize = async (): Promise<void> => {
      const existingItem = await getExistingItem({ seedUid, seedLocalId })

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

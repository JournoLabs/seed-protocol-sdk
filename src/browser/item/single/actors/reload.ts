import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import { ItemMachineContext } from '@/types/item'

export const reload = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(({ sendBack, input: { context } }) => {
  const { propertyInstances } = context

  const _reload = async () => {
    if (!propertyInstances) {
      return
    }

    for (const propertyInstance of propertyInstances.values()) {
      if (propertyInstance) {
        const propertyRecordSchema = propertyInstance.propertyDef
        if (
          propertyRecordSchema &&
          propertyRecordSchema.storageType &&
          propertyRecordSchema.storageType === 'ItemStorage'
        ) {
          propertyInstance.getService().send({ type: 'reload' })
        }
      }
    }
  }

  _reload().then(() => {
    sendBack({ type: 'reloadSuccess' })
  })
})

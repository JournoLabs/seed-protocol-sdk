import { EventObject, fromCallback } from 'xstate'
import { waitForEvent } from '@/events'
import {
  FromCallbackInput,
  HydrateExistingItemEvent,
  ItemMachineContext,
} from '@/types'

export const hydrateExistingItem = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>, HydrateExistingItemEvent>
>(({ sendBack, input: { event, context } }) => {
  const { existingItem } = event!
  const { seedUid, seedLocalId, modelName: contextModelName, ModelClass } = context

  // Prefer modelName from context, fall back to ModelClass if available
  let modelName = contextModelName
  if (!modelName && ModelClass) {
    // If ModelClass is a Model instance, use its modelName property
    modelName = (ModelClass as any)?.modelName || (ModelClass as any)?.originalConstructor?.name
  }
  
  if (!modelName) {
    throw new Error('modelName is required in context')
  }

  const _checkForItemOnAllItemsService = async (): Promise<boolean> => {
    if (!existingItem.seedLocalId && !existingItem.seedUid) {
      console.warn(
        '[singleItemActors] [hydrateExistingItem] No seedLocalId or seedUid found on existingItem',
      )
      return false
    }

    if (!seedUid && !seedLocalId) {
      return false
    }

    const results = await waitForEvent({
      req: {
        eventLabel: 'item.request',
        data: {
          modelName,
          seedUid,
          seedLocalId,
          source: 'hydrateExistingItem',
        },
      },
      res: {
        eventLabel: `item.${modelName}.${seedLocalId}.response`,
      },
    })

    return true

    // return new Promise((resolve) => {
    // const timeStart = Date.now()
    //
    // const interval = setInterval(() => {
    //   const timeElapsed = Date.now() - timeStart
    //   if (timeElapsed > 2000) {
    //     eventEmitter.emit('item.request', {
    //       modelName,
    //       versionUid,
    //       versionLocalId,
    //       source: 'hydrateExistingItem',
    //     })
    //   }
    //   if (timeElapsed > 30000) {
    //     clearInterval(interval)
    //     console.error(
    //       `[singleItemActors] [hydrateExistingItem] ${timeElapsed / 1000}s elapsed for ${modelName} ${versionLocalId}`,
    //       context,
    //     )
    //     eventEmitter.removeListener(
    //       `item.${modelName}.response`,
    //       handleItemRequestResponse,
    //     )
    //     resolve(false)
    //   }
    // }, 500)

    // const handleItemRequestResponse = (event) => {
    //   if (
    //     event.item &&
    //     ((event.item.versionLocalId &&
    //       event.item.versionLocalId === versionLocalId) ||
    //       (event.item.versionUid && event.item.versionUid === versionUid))
    //   ) {
    //     clearInterval(interval)
    //     eventEmitter.removeListener(
    //       `item.${modelName}.response`,
    //       handleItemRequestResponse,
    //     )
    //     resolve(true)
    //   }
    // }
    //
    // eventEmitter.addListener(
    //   `item.${modelName}.response`,
    //   handleItemRequestResponse,
    // )
    //
    // eventEmitter.emit('item.request', {
    //   modelName,
    //   versionUid,
    //   versionLocalId,
    //   source: 'hydrateExistingItem',
    // })
    // })

    // if (existingItem.versionLocalId && !existingItem.versionLocalId) {
    //   console.log(
    //     `[singleItemActors] [hydrateExistingItem] versionLocalId: ${existingItem.versionLocalId} versionUid: ${existingItem.versionUid}`,
    //   )
    //
    //   return true
    // }
    //
    // console.log(
    //   `[singleItemActors] [hydrateExistingItem] versionLocalId: ${existingItem.versionLocalId} versionUid: ${existingItem.versionUid}`,
    // )
    // return true
  }

  _checkForItemOnAllItemsService().then((shouldContinue) => {
    if (!shouldContinue) {
      sendBack({ type: 'hydrateExistingItemFailure' })
      return
    }
    // for (const [key, value] of Object.entries(existingItem)) {
    //   sendBack({
    //     type: 'updateValue',
    //     propertyName: key,
    //     propertyValue: value,
    //     source: 'db',
    //   })
    // }

    sendBack({ type: 'hydrateExistingItemSuccess' })
  })
})

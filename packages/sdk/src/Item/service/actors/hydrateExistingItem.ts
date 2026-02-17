import { EventObject, fromCallback } from 'xstate'
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

    // Note: Removed waitForEvent call - item.request handler is commented out and never resolves
    // Item hydration now happens directly via XState without event bus
    return true
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

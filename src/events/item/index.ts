import { eventEmitter } from '@/eventBus'
import { syncDbWithEasHandler } from '@/events/item/syncDbWithEas'
import { publishItemRequestHandler } from '@/events/item/publish'

let areReady = false

export const setupAllItemsEventHandlers = () => {
  // Active event handlers - these are still in use
  eventEmitter.addListener('syncDbWithEas', syncDbWithEasHandler)
  eventEmitter.addListener('item.publish.request', publishItemRequestHandler)
  eventEmitter.addListener(
    'item.publish.payload.request',
    publishItemRequestHandler,
  )
  areReady = true
}

// Note: getAreItemEventHandlersReady removed - was only used by useItemIsReady hook which has been removed

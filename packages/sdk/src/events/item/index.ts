import { eventEmitter } from '@/eventBus'
import { syncDbWithEasHandler } from '@/events/item/syncDbWithEas'

let areReady = false

export const setupAllItemsEventHandlers = () => {
  eventEmitter.addListener('syncDbWithEas', syncDbWithEasHandler)
  areReady = true
}

// Note: getAreItemEventHandlersReady removed - was only used by useItemIsReady hook which has been removed

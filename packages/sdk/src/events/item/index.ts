import { eventEmitter } from '@/eventBus'
import {
  requestEasSyncFromEventBus,
  startEasSyncActor,
} from '@/events/item/easSyncManager'

let areReady = false

export const setupAllItemsEventHandlers = () => {
  startEasSyncActor()
  eventEmitter.addListener('syncDbWithEas', requestEasSyncFromEventBus)
  areReady = true
}

// Note: getAreItemEventHandlersReady removed - was only used by useItemIsReady hook which has been removed

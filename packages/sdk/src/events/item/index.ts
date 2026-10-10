import { eventEmitter } from '@/eventBus'
import {
  listenForEasSyncRequestsFromOtherTabs,
  requestEasSyncFromEventBus,
  startEasSyncActor,
} from '@/events/item/easSyncManager'
import { listenForOtherTabsEvents } from '@/helpers/tabEvents'

let areReady = false

export const setupAllItemsEventHandlers = () => {
  startEasSyncActor()
  listenForEasSyncRequestsFromOtherTabs()
  listenForOtherTabsEvents()
  eventEmitter.addListener('syncDbWithEas', requestEasSyncFromEventBus)
  areReady = true
}

// Note: getAreItemEventHandlersReady removed - was only used by useItemIsReady hook which has been removed

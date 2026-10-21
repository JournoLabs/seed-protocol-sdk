import {
  listenForEasSyncRequestsFromOtherTabs,
  startEasSyncActor,
} from '@/events/item/easSyncManager'
import { listenForOtherTabsEvents } from '@/helpers/tabEvents'


export const setupAllItemsEventHandlers = () => {
  startEasSyncActor()
  listenForEasSyncRequestsFromOtherTabs()
  listenForOtherTabsEvents()
}

// Note: getAreItemEventHandlersReady removed - was only used by useItemIsReady hook which has been removed

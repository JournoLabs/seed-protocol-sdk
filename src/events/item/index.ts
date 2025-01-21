import { eventEmitter } from '@/eventBus'
import { syncDbWithEasHandler } from '@/events/item/syncDbWithEas'
import { publishItemRequestHandler } from '@/events/item/publish'

let areReady = false

export const setupAllItemsEventHandlers = () => {
  // eventEmitter.addListener('item.request', itemRequestHandler)
  // eventEmitter.addListener('item.requestAll', itemRequestAllHandler)
  // eventEmitter.addListener(
  //   'item.propertyValuesForSeedUid.request',
  //   propertyValuesForSeedUid,
  // )
  // eventEmitter.addListener('item.create.request', createItemRequestHandler)
  // eventEmitter.addListener('item.delete.request', itemDeleteRequestHandler)
  // eventEmitter.addListener('item.update', itemUpdateHandler)
  eventEmitter.addListener('syncDbWithEas', syncDbWithEasHandler)
  eventEmitter.addListener('item.publish.request', publishItemRequestHandler)
  eventEmitter.addListener(
    'item.publish.payload.request',
    publishItemRequestHandler,
  )
  //
  // eventEmitter.emit('item.events.setupAllItemsEventHandlers')
  areReady = true
}

export const getAreItemEventHandlersReady = () => {
  return areReady
}

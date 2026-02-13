import { fromCallback, EventObject, sendTo, } from "xstate";
import debug from 'debug'
import { PublishManager } from "..";

const logger = debug('seedProtocol:services:PublishManager:actors:subscribe')

export const subscribe = fromCallback<
  EventObject,
  any
>(({sendBack, receive, input: {publishProcess, seedLocalId}}) => {
  const subscription = publishProcess.subscribe(async (snapshot) => {
    logger('Publish state:', snapshot.value);
    PublishManager.savePublish(seedLocalId, publishProcess)
    if (snapshot.status === 'done') {
      PublishManager.savePublish(seedLocalId, publishProcess)
      PublishManager.getService().send({ type: 'PUBLISH_DONE', seedLocalId })
    }
  });

  receive(({type,}) => {
    if (type === 'UNSUBSCRIBE' ) {
      logger('Received UNSUBSCRIBE event')
      subscription.unsubscribe()
      PublishManager.removeSubscription(seedLocalId)
    }
  })
})
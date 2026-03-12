import { fromCallback, EventObject } from 'xstate'
import { getPublishManagerRef } from '../publishManagerRef'
import debug from 'debug'

const logger = debug('seedProtocol:services:PublishManager:actors:subscribe')

export interface SubscribeInput {
  publishProcess: import('xstate').ActorRef<any, any>
  seedLocalId: string
}

export const subscribe = fromCallback<EventObject, SubscribeInput>(
  ({ receive, input: { publishProcess, seedLocalId } }) => {
    const managerRef = getPublishManagerRef()

    const subscription = publishProcess.subscribe(async (snapshot) => {
      logger('Publish state:', snapshot.value)
      if (managerRef) {
        managerRef.savePublish(seedLocalId, publishProcess)
      }
      if (snapshot.status === 'done' && managerRef) {
        managerRef.savePublish(seedLocalId, publishProcess)
        managerRef.onPublishDone(seedLocalId)
      }
    })

    receive(({ type }) => {
      if (type === 'UNSUBSCRIBE') {
        logger('Received UNSUBSCRIBE event')
        subscription.unsubscribe()
        managerRef?.removeSubscription(seedLocalId)
      }
    })
  }
)

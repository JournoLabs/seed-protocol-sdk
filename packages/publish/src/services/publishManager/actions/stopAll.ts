import type { ActorRef, EventObject } from 'xstate'
import { enqueueActions } from 'xstate'
import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:index')

export const stopAll = enqueueActions(({ context, enqueue }) => {
  logger('Stopping all actors...')

  context.publishProcesses.forEach((publishProcess: ActorRef<any, any>) => {
    enqueue.stopChild(publishProcess)
  })
  context.subscriptions.forEach((subscriptionProcess: ActorRef<any, EventObject>) => {
    enqueue.stopChild(subscriptionProcess)
  })

  enqueue.assign({
    publishProcesses: new Map(),
    subscriptions: new Map(),
  })
})

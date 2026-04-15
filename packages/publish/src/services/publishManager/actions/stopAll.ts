import type { ActorRef, AnyActorRef, EventObject } from 'xstate'
import { enqueueActions } from 'xstate'
import debug from 'debug'
import { stopScopedOrStandaloneChild } from './stopScopedOrStandaloneChild'

const logger = debug('seedProtocol:PublishManager:index')

export const stopAll = enqueueActions(({ context, enqueue, self }) => {
  logger('Stopping all actors...')

  context.publishProcesses.forEach((publishProcess: ActorRef<any, any>) => {
    stopScopedOrStandaloneChild(self, publishProcess as AnyActorRef, enqueue)
  })
  context.subscriptions.forEach((subscriptionProcess: ActorRef<any, EventObject>) => {
    stopScopedOrStandaloneChild(self, subscriptionProcess as AnyActorRef, enqueue)
  })

  enqueue.assign({
    publishProcesses: new Map(),
    subscriptions: new Map(),
  })
})

import type { ActorRef } from 'xstate'
import { enqueueActions, stop } from 'xstate'
import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:index')

export const stopAll = enqueueActions(({ context, enqueue }) => {
  logger('Stopping all actors...')

  context.publishProcesses.forEach((publishProcess: ActorRef<any, any>) => {
    enqueue(stop(publishProcess))
  })
  context.subscriptions.forEach((subscriptionProcess: ActorRef<any, any>) => {
    enqueue(stop(subscriptionProcess))
  })

  enqueue.assign({
    publishProcesses: new Map(),
    subscriptions: new Map(),
  })
})

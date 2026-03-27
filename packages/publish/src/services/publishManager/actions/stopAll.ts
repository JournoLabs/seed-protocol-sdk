import type { ActorRef } from 'xstate'
import { enqueueActions } from 'xstate'
import debug from 'debug'

const logger = debug('seedProtocol:PublishManager:index')

export const stopAll = enqueueActions(({ context, enqueue }) => {
  logger('Stopping all actors...')

  context.publishProcesses.forEach((publishProcess: ActorRef<any, any>) => {
    publishProcess.stop()
  })
  context.subscriptions.forEach((subscriptionProcess: ActorRef<any, any>) => {
    subscriptionProcess.stop()
  })

  enqueue.assign({
    publishProcesses: new Map(),
    subscriptions: new Map(),
  })
})

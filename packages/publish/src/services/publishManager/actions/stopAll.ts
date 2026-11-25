import type { ActorRef, AnyActorRef, EventObject } from 'xstate'
import { enqueueActions } from 'xstate'
import debug from 'debug'
import { stopScopedOrStandaloneChild } from './stopScopedOrStandaloneChild'
import { releaseAllPublishLocks } from '../publishLocks'
import { stopWatchingForTakeovers } from '../takeover'
import { waitForWallet } from '../walletWait'

const logger = debug('seedProtocol:PublishManager:index')

export const stopAll = enqueueActions(({ context, enqueue, self }) => {
  logger('Stopping all actors...')

  context.publishProcesses.forEach((publishProcess: ActorRef<any, any>, seedLocalId: string) => {
    stopScopedOrStandaloneChild(self, publishProcess as AnyActorRef, enqueue)
    // Its row stays in_progress: this tab resumes it when its wallet publishes as its address again.
    waitForWallet(seedLocalId, (publishProcess.getSnapshot() as { context?: { address?: unknown } }).context?.address)
  })
  context.subscriptions.forEach((subscriptionProcess: ActorRef<any, EventObject>) => {
    stopScopedOrStandaloneChild(self, subscriptionProcess as AnyActorRef, enqueue)
  })

  // Stopped here, but rows stay in_progress: the next tab to restore may resume them.
  releaseAllPublishLocks()
  stopWatchingForTakeovers()

  enqueue.assign({
    publishProcesses: new Map(),
    subscriptions: new Map(),
  })
})

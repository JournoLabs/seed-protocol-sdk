import type { AnyActorRef } from 'xstate'
import { enqueueActions } from 'xstate'
import { stopScopedOrStandaloneChild } from './stopScopedOrStandaloneChild'
import { markInProgressPublishInterrupted } from '../actors/savePublish'
import { decidePublishLock, releasePublishLock } from '../publishLocks'

export const stopPublish = enqueueActions(({ context, event, enqueue, self }) => {
  const { publishProcesses, subscriptions } = context
  const { seedLocalId } = event as unknown as { seedLocalId: string }

  // The lock goes once the row says interrupted: a tab queued for it (takeover.ts) reads the row
  // when granted, and would resume a publish it still read as in progress.
  // A Publish meanwhile waits for the release (decidePublishLock) rather than keep this hold.
  void decidePublishLock(
    seedLocalId,
    markInProgressPublishInterrupted(seedLocalId)
      .catch((error) => {
        console.warn(
          `[stopPublish] Failed to mark publish_processes row interrupted for "${seedLocalId}":`,
          error,
        )
      })
      .finally(() => releasePublishLock(seedLocalId)),
  )

  const publishProcess = publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`)
    return
  }

  stopScopedOrStandaloneChild(self, publishProcess as AnyActorRef, enqueue)

  const subscriptionProcess = subscriptions.get(seedLocalId)
  if (subscriptionProcess) {
    stopScopedOrStandaloneChild(self, subscriptionProcess as AnyActorRef, enqueue)
  }

  const newPublishProcesses = new Map(publishProcesses)
  newPublishProcesses.delete(seedLocalId)
  const newSubscriptions = new Map(subscriptions)
  newSubscriptions.delete(seedLocalId)

  enqueue.assign({
    publishProcesses: newPublishProcesses,
    subscriptions: newSubscriptions,
  })
})

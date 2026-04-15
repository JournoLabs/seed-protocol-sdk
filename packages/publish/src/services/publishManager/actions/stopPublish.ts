import type { AnyActorRef } from 'xstate'
import { enqueueActions } from 'xstate'
import { stopScopedOrStandaloneChild } from './stopScopedOrStandaloneChild'
import { markInProgressPublishInterrupted } from '../actors/savePublish'

export const stopPublish = enqueueActions(({ context, event, enqueue, self }) => {
  const { publishProcesses, subscriptions } = context
  const { seedLocalId } = event as unknown as { seedLocalId: string }

  void markInProgressPublishInterrupted(seedLocalId).catch((error) => {
    console.warn(
      `[stopPublish] Failed to mark publish_processes row interrupted for "${seedLocalId}":`,
      error,
    )
  })

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

import { enqueueActions } from 'xstate'

export const stopPublish = enqueueActions(({ context, event, enqueue }) => {
  const { publishProcesses, subscriptions } = context
  const { seedLocalId } = event as unknown as { seedLocalId: string }

  const publishProcess = publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`)
    return
  }

  publishProcess.stop()

  const subscriptionProcess = subscriptions.get(seedLocalId)
  if (subscriptionProcess) {
    subscriptionProcess.stop()
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

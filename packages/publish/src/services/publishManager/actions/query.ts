import { enqueueActions } from 'xstate'

export const query = enqueueActions(({ context, event, enqueue }) => {
  const { seedLocalId } = event as unknown as { seedLocalId: string }
  const publishProcess = context.publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`)
    return
  }

  publishProcess.stop()

  const subscriptionProcess = context.subscriptions.get(seedLocalId)
  if (subscriptionProcess) {
    subscriptionProcess.stop()
  }

  const newPublishProcesses = new Map(context.publishProcesses)
  newPublishProcesses.delete(seedLocalId)
  const newSubscriptions = new Map(context.subscriptions)
  newSubscriptions.delete(seedLocalId)

  enqueue.assign({
    publishProcesses: newPublishProcesses,
    subscriptions: newSubscriptions,
  })
})

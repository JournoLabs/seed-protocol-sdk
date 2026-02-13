import { assign } from "xstate";

export const publishDone = assign(({context, event}) => {
  const { publishProcesses, subscriptions } = context
  const seedLocalId = (event as { seedLocalId: string }).seedLocalId
  const subscriptionProcess = subscriptions.get(seedLocalId)
  if (subscriptionProcess) {
    subscriptionProcess.send({ type: 'UNSUBSCRIBE' })
  }
  const newPublishProcesses = new Map(publishProcesses)
  newPublishProcesses.delete(seedLocalId)
  const newSubscriptions = new Map(subscriptions)
  newSubscriptions.delete(seedLocalId)
  return {
    publishProcesses: newPublishProcesses,
    subscriptions: newSubscriptions,
  };
})
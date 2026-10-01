import { assign } from 'xstate'

export const publishDone = assign(({ context, event }) => {
  const { publishProcesses, subscriptions, settledPublishes } = context
  const seedLocalId = (event as unknown as { seedLocalId: string }).seedLocalId
  const subscriptionProcess = subscriptions.get(seedLocalId)
  if (subscriptionProcess) {
    subscriptionProcess.send({ type: 'UNSUBSCRIBE' })
  }
  const finished = publishProcesses.get(seedLocalId)
  const newPublishProcesses = new Map(publishProcesses)
  newPublishProcesses.delete(seedLocalId)
  const newSubscriptions = new Map(subscriptions)
  newSubscriptions.delete(seedLocalId)
  const newSettled = new Map(settledPublishes)
  if (finished) newSettled.set(seedLocalId, finished)
  return {
    publishProcesses: newPublishProcesses,
    subscriptions: newSubscriptions,
    settledPublishes: newSettled,
  }
})

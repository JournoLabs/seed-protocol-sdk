import { assign } from 'xstate'

export const removeSubscription = assign(({ context, event }) => {
  const { subscriptions } = context
  const seedLocalId = (event as unknown as { seedLocalId: string }).seedLocalId
  const newSubscriptions = new Map(subscriptions)
  newSubscriptions.delete(seedLocalId)
  return {
    subscriptions: newSubscriptions,
  }
})

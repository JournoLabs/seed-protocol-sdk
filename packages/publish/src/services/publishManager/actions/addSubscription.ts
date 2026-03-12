import { assign } from 'xstate'

export const addSubscription = assign(({ context, event }) => {
  const { subscriptions } = context
  const { seedLocalId, newSubscription } = event as unknown as {
    seedLocalId: string
    newSubscription?: import('xstate').ActorRef<any, import('xstate').EventObject>
  }

  if (newSubscription) {
    subscriptions.set(seedLocalId, newSubscription)
  }

  return {
    subscriptions: new Map(subscriptions),
  }
})

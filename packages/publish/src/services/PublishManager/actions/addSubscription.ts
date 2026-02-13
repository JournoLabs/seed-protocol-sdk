import { assign } from "xstate";

export const addSubscription = assign(({context, event,}) => {
  const { subscriptions} = context
  const { seedLocalId, newSubscription } = event;

  subscriptions.set(seedLocalId, newSubscription)

  return {
    subscriptions: new Map(subscriptions),
  };
})
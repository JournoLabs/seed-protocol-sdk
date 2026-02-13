import { enqueueActions, raise, } from "xstate"
import { publishMachine } from "../../publish";
import { subscribe } from "../actors/subscribe";

export const createPublish= enqueueActions(({event, enqueue,}) => {
  const { item, address, account } = event;

  const hasAddress = address != null && typeof address === 'string' && address.trim().length > 0;
  if (!hasAddress) {
    console.warn('[createPublish] No valid wallet address; skipping spawn.');
    return;
  }

  enqueue.assign(({context, spawn}) => {
    const { publishProcesses } = context
    if (publishProcesses && publishProcesses.has(item.seedLocalId)) {
      console.warn(`Publish process with seedLocalId "${item.seedLocalId}" already exists.`);
      return context; // Prevent duplicate publish processes
    }
    const publishProcess = spawn(publishMachine, {
      input: {
        item,
        address: address as string,
        account,
        modelName: (item as { modelName?: string }).modelName,
        schemaId: (item as { schemaId?: string }).schemaId,
      },
    });

    publishProcesses.set(item.seedLocalId, publishProcess)

    return {
      publishProcesses: new Map(publishProcesses),
    };
  })

  enqueue.assign(({context, spawn}) => {
    const { subscriptions, publishProcesses } = context
    const publishProcess = publishProcesses.get(item.seedLocalId)
    if (!publishProcess) {
      console.warn(`Publish process with seedLocalId "${item.seedLocalId}" does not exist.`);
      return context; // Prevent duplicate publish processes
    }

    if (subscriptions && subscriptions.has(item.seedLocalId)) {
      console.warn(`Subscription with seedLocalId "${item.seedLocalId}" already exists.`);
      return context; // Prevent duplicate publish processes
    }

    const subscriptionProcess = spawn(subscribe, { 
      input: { publishProcess, seedLocalId: item.seedLocalId } 
    });

    subscriptions.set(item.seedLocalId, subscriptionProcess)

    return {
      subscriptions: new Map(subscriptions),
    };
  })

  enqueue(raise({type: 'REQUEST_SAVE_PUBLISH', seedLocalId: item.seedLocalId}))
})
import { assign } from "xstate"

export const query = assign(({context, event}) => {
  const { seedLocalId } = event as { seedLocalId: string }
  const publishProcess = context.publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`);
    return context;
  }

  publishProcess.stop?.()
  const newPublishProcesses = new Map(context.publishProcesses)
  newPublishProcesses.delete(seedLocalId)
  const newSubscriptions = new Map(context.subscriptions)
  newSubscriptions.delete(seedLocalId)

  return {
    ...context,
    publishProcesses: newPublishProcesses,
    subscriptions: newSubscriptions,
  };
})

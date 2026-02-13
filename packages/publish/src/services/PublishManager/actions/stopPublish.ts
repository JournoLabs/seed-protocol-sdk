import { assign } from "xstate"


export const stopPublish= assign(({context, event, spawn}) => {
  const { publishProcesses } = context
  const { seedLocalId } = event;

  const publishProcess = publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`);
    return context;
  }

  publishProcess.stop();

  publishProcesses.delete(seedLocalId)

  return {
    publishProcesses: new Map(publishProcesses),
  }
})
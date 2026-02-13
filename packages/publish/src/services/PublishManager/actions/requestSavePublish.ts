import { assign,} from "xstate"
import { savePublish } from "../actors/savePublish"

export const requestSavePublish = assign(({context, event, spawn}) => {
  const { publishProcesses } = context
  const { seedLocalId, publishProcess } = event as { seedLocalId: string; publishProcess?: { getPersistedSnapshot: () => unknown } }

  if (!publishProcess) {
    return context
  }

  const newPublishProcesses = new Map(publishProcesses)
  newPublishProcesses.set(seedLocalId, publishProcess)

  const persistedSnapshot = publishProcess.getPersistedSnapshot()

  spawn(savePublish, {
    id: `savePublish_${seedLocalId}_${Date.now()}`,
    input: { persistedSnapshot, seedLocalId },
  })

  return { publishProcesses: newPublishProcesses }
})
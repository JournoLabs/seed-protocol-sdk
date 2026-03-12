import { enqueueActions, stop } from 'xstate'

export const stopPublish = enqueueActions(({ context, event, enqueue }) => {
  const { publishProcesses } = context
  const { seedLocalId } = event as unknown as { seedLocalId: string }

  const publishProcess = publishProcesses.get(seedLocalId)
  if (!publishProcess) {
    console.warn(`Publish process with seedLocalId "${seedLocalId}" does not exist.`)
    return
  }

  enqueue(stop(publishProcess))

  const newPublishProcesses = new Map(publishProcesses)
  newPublishProcesses.delete(seedLocalId)
  enqueue.assign({
    publishProcesses: newPublishProcesses,
  })
})

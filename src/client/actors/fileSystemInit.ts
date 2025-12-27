import { BaseFileManager } from "@/helpers";
import { ClientManagerContext, FromCallbackInput } from "@/types/machines";
import { EventObject, fromCallback } from "xstate";
import { areFsListenersReady, setupFsListeners } from "@/events/files";
import { eventEmitter } from "@/eventBus";


export const fileSystemInit = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext>
>(({sendBack, input: {context}}) => {

  setupFsListeners()

  if (!areFsListenersReady()) {
    throw new Error('fs listeners not ready during init')
  }

  const _fileSystemInit = async () => {
    const { filesDir } = context
    if (!filesDir) {
      throw new Error('filesDir is required')
    }
    await BaseFileManager.initializeFileSystem(filesDir)
    eventEmitter.emit('fs.init')
  }

  _fileSystemInit().then(() => {
    sendBack({ type: 'fileSystemReady' })
  })
})
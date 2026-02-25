import { BaseFileManager } from "@/helpers";
import { ClientManagerContext, FromCallbackInput } from "@/types/machines";
import { EventObject, fromCallback } from "xstate";
import { areFsListenersReady, setupFsListeners } from "@/events/files";
import { eventEmitter } from "@/eventBus";
import debug from "debug";

const logger = debug('seedSdk:client:actors:fileSystemInit')

export const fileSystemInit = fromCallback<
EventObject, 
FromCallbackInput<ClientManagerContext>
>(({sendBack, input: {context},}) => {

  setupFsListeners()

  if (!areFsListenersReady()) {
    throw new Error('fs listeners not ready during init')
  }

  // Check for filesDir synchronously before starting async operation
  // This ensures the error is thrown synchronously and caught by XState
  const { filesDir } = context
  if (!filesDir) {
    throw new Error('filesDir is required')
  }

  const _fileSystemInit = async () => {
    await BaseFileManager.initializeFileSystem(filesDir)
    eventEmitter.emit('fs.init')
  }

  _fileSystemInit()
    .then(() => {
      sendBack({ type: 'fileSystemReady' })
    })
    .catch((error) => {
      // Send error event using sendBack - this is the recommended XState pattern
      // The parent state machine should handle the 'ERROR' event
      sendBack({ 
        type: 'error', 
        error: error instanceof Error ? error : new Error(String(error))
      })
    })

  // Return cleanup function
  return () => {
    // Cleanup if needed
  }
})
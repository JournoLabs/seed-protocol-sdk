import { createActor, waitFor } from 'xstate'
import { publishMachine } from '@/services/publish/publishMachine'
import { eventEmitter } from '@/eventBus'
// Dynamic import to break circular dependency: BaseItem -> ... -> publish -> BaseItem
// import { BaseItem } from '@/Item/BaseItem'
import debug from 'debug'

const logger = debug('seedSdk:events:item:publish')

type PublishItemRequestEvent = {
  seedLocalId: string
}

type PublishItemRequestHandler = (
  event: PublishItemRequestEvent,
) => Promise<void>

export const publishItemRequestHandler: PublishItemRequestHandler = async ({
  seedLocalId,
}) => {
  logger('[publish] Starting publish for seedLocalId:', seedLocalId)
  
  try {
    // Dynamic import to break circular dependency
    const { BaseItem } = await import('@/Item/BaseItem')
    // Find the item
    const item = await BaseItem.find({ seedLocalId })
    
    if (!item) {
      throw new Error(`Item not found for seedLocalId: ${seedLocalId}`)
    }

    // Spawn publishMachine directly (no longer needs global service)
    const publishService = createActor(publishMachine, {
      input: {
        localId: seedLocalId,
        status: 'validating',
      },
    })

    publishService.start()

    // Wait for publish machine to complete
    await waitFor(
      publishService,
      (snapshot) => {
        const state = snapshot.value
        // Publish is complete when it reaches IDLE state
        return state === 'idle'
      },
      { timeout: 300000 } // 5 minute timeout for publish operations
    )

    logger('[publish] Publish completed for seedLocalId:', seedLocalId)
    
    // Emit success event that BaseItem.publish() is waiting for
    eventEmitter.emit(`item.${seedLocalId}.publish.success`, {
      seedLocalId,
    })
  } catch (error: any) {
    logger('[publish] Error publishing item:', error)
    // Emit error event
    eventEmitter.emit(`item.${seedLocalId}.publish.error`, {
      seedLocalId,
      error,
    })
    throw error
  }
}

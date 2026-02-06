import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import { ItemMachineContext } from '@/types/item'
import type { Item } from '@/Item/Item'
import debug from 'debug'

const logger = debug('seedSdk:Item:runPublish')

export const runPublish = fromCallback<
  EventObject,
  FromCallbackInput<ItemMachineContext<any>>
>(({ sendBack, input: { context } }) => {
  const { seedLocalId } = context

  const _runPublish = async () => {
    if (!seedLocalId) {
      sendBack({ type: 'publishError', error: new Error('Item has no seedLocalId') })
      return
    }

    try {
      const { Item } = await import('@/Item/Item')
      const item = await Item.find({ seedLocalId })

      if (!item) {
        sendBack({ type: 'publishError', error: new Error(`Item not found for seedLocalId: ${seedLocalId}`) })
        return
      }

      const { getPublishUploads } = await import('@/db/read/getPublishUploads')
      const { getPublishPayload } = await import('@/db/read/getPublishPayload')

      await getPublishUploads(item)
      // For first iteration: no Arweave sign/upload - pass empty uploadedTransactions.
      // Real upload/submit can be wired in later.
      const uploadedTransactions: { txId: string; seedLocalId?: string }[] = []
      await getPublishPayload(item as Item<any>, uploadedTransactions)

      logger('runPublish: payload prepared (upload/EAS submit stubbed)')
      sendBack({ type: 'publishSuccess' })
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      logger('runPublish error:', error)
      sendBack({ type: 'publishError', error })
    }
  }

  _runPublish()
})

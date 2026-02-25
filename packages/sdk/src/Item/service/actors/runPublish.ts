import { EventObject, fromCallback } from 'xstate'
import { FromCallbackInput } from '@/types/machines'
import { ItemMachineContext } from '@/types/item'
import type { Item } from '@/Item/Item'
import debug from 'debug'
import { getUploadExecutor } from '@/helpers/publishConfig'

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
      const itemMod = await import('../../../Item/Item')
      const { Item } = itemMod
      const item = await Item.find({ seedLocalId })

      if (!item) {
        sendBack({ type: 'publishError', error: new Error(`Item not found for seedLocalId: ${seedLocalId}`) })
        return
      }

      const getPublishUploadsMod = await import('../../../db/read/getPublishUploads')
      const { getPublishUploads } = getPublishUploadsMod
      const getPublishPayloadMod = await import('../../../db/read/getPublishPayload')
      const { getPublishPayload } = getPublishPayloadMod

      const uploads = await getPublishUploads(item)

      let uploadedTransactions: { txId: string; seedLocalId?: string; versionLocalId?: string }[] = []
      const executor = getUploadExecutor()
      if (executor && uploads.length > 0) {
        for (const upload of uploads) {
          const { txId } = await executor(upload)
          uploadedTransactions.push({
            txId,
            seedLocalId: upload.seedLocalId,
            versionLocalId: upload.versionLocalId,
          })
        }
      }

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

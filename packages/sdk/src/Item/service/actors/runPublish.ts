import { EventObject, fromCallback } from 'xstate'
import { ItemMachineContext } from '@/types/item'
import type { Item } from '@/Item/Item'
import type { IItem } from '@/interfaces/IItem'
import debug from 'debug'
import {
  getPublishExecutor,
  PUBLISH_NOT_CONFIGURED_MESSAGE,
  type ItemPublishOptions,
} from '@/helpers/publishConfig'

const logger = debug('seedSdk:Item:runPublish')

/**
 * Runs the publish for item.publish() by handing the item to the PublishExecutor that
 * @seedprotocol/publish registers, which uploads to Arweave and writes to EAS.
 */
export const runPublish = fromCallback<
  EventObject,
  { context: ItemMachineContext<any>; item?: IItem<any>; options?: ItemPublishOptions }
>(({ sendBack, input: { context, item: itemFromEvent, options } }) => {
  const { seedLocalId } = context

  const _runPublish = async () => {
    if (!seedLocalId) {
      sendBack({ type: 'publishError', error: new Error('Item has no seedLocalId') })
      return
    }
    const executor = getPublishExecutor()
    if (!executor) {
      sendBack({ type: 'publishError', error: new Error(PUBLISH_NOT_CONFIGURED_MESSAGE) })
      return
    }
    try {
      // item.publish() sends its own instance; look it up only if startPublish came without one.
      const loaded = itemFromEvent
        ? undefined
        : ((await (await import('../../../Item/Item')).Item.find({ seedLocalId, hold: true })) as Item<any> | undefined)
      const item = itemFromEvent ?? loaded
      if (!item) {
        sendBack({ type: 'publishError', error: new Error(`Item not found: ${seedLocalId}`) })
        return
      }
      try {
        await executor(item, options)
      } finally {
        loaded?.unload()
      }
      sendBack({ type: 'publishSuccess' })
    } catch (error) {
      logger('runPublish error:', error)
      sendBack({ type: 'publishError', error: error instanceof Error ? error : new Error(String(error)) })
    }
  }

  _runPublish()
})

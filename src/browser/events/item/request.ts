import { getItem } from '@/browser/db/read/getItem'
import { eventEmitter } from '@/eventBus'

const activeItemRequests = new Set<string>()

const queue = new Map<string, Record<string, unknown>>()

export const itemRequestHandler = async (event) => {
  const { seedLocalId, seedUid, modelName, eventId } = event

  if (activeItemRequests.has(seedLocalId)) {
    queue.set(seedLocalId, event)
    return
  }

  const item = await getItem({
    modelName,
    seedLocalId,
    seedUid,
  })

  if (!item) {
    console.warn(
      `[item/events] [itemRequestHandler] no item for seedLocalId ${seedLocalId} or versionUid ${seedUid}`,
    )
    if (eventId) {
      eventEmitter.emit(`item.${modelName}.${seedLocalId}.response`, {
        item,
        eventId,
      })
    }
    return
  }

  eventEmitter.emit(`item.${modelName}.${seedLocalId}.response`, {
    item,
    eventId,
  })

  queue.delete(seedLocalId)
  if (queue.size > 0 && queue.has(seedLocalId)) {
    const nextEvent = queue.get(seedLocalId)
    await itemRequestHandler(nextEvent)
  }
}

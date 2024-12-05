import { eventEmitter } from '@/eventBus'
import { generateId } from '@/shared/helpers'

export * from './item'

type WaitForEventConfig = {
  req: {
    eventLabel: string
    data: Record<string, unknown>
  }
  res: {
    eventLabel: string
  }
}

type WaitForEvent = (
  config: WaitForEventConfig,
) => Promise<Record<string, unknown>>

export const waitForEvent: WaitForEvent = async ({ req, res }) => {
  const eventId = generateId()

  return new Promise((resolve) => {
    const internalHandler = (event: Record<string, unknown>) => {
      if (!event) {
        return
      }
      const { eventId: _eventId } = event
      if (_eventId && _eventId === eventId) {
        eventEmitter.removeListener(res.eventLabel, internalHandler)
        resolve(event)
      }
    }

    eventEmitter.addListener(res.eventLabel, internalHandler)

    eventEmitter.emit(req.eventLabel, {
      ...req.data,
      eventId,
    })
  })
}

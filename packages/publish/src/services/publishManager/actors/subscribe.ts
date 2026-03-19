import { fromCallback, EventObject } from 'xstate'
import { getPublishManagerRef } from '../publishManagerRef'
import {
  LONG_RUNNING_PUBLISH_STATES,
  PERIODIC_SAVE_INTERVAL_MS,
} from '~/helpers/constants'
import debug from 'debug'

const logger = debug('seedProtocol:services:PublishManager:actors:subscribe')

function getStateValue(snapshot: { value?: unknown }): string {
  const v = snapshot.value
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    return (keys[0] ?? '') as string
  }
  return ''
}

function isLongRunningState(stateValue: string): boolean {
  return LONG_RUNNING_PUBLISH_STATES.includes(stateValue as (typeof LONG_RUNNING_PUBLISH_STATES)[number])
}

export interface SubscribeInput {
  publishProcess: import('xstate').ActorRef<any, any>
  seedLocalId: string
}

export const subscribe = fromCallback<EventObject, SubscribeInput>(
  ({ receive, input: { publishProcess, seedLocalId } }) => {
    const managerRef = getPublishManagerRef()
    let periodicSaveIntervalId: ReturnType<typeof setInterval> | null = null

    const clearPeriodicSave = () => {
      if (periodicSaveIntervalId != null) {
        clearInterval(periodicSaveIntervalId)
        periodicSaveIntervalId = null
      }
    }

    const startPeriodicSaveIfNeeded = (snapshot: { value?: unknown }) => {
      const stateValue = getStateValue(snapshot)
      if (isLongRunningState(stateValue) && periodicSaveIntervalId == null && managerRef) {
        periodicSaveIntervalId = setInterval(() => {
          managerRef?.savePublish(seedLocalId, publishProcess)
        }, PERIODIC_SAVE_INTERVAL_MS)
      } else if (!isLongRunningState(stateValue)) {
        clearPeriodicSave()
      }
    }

    const subscription = publishProcess.subscribe(async (snapshot) => {
      logger('Publish state:', snapshot.value)
      if (managerRef) {
        if (snapshot.status === 'done') {
          clearPeriodicSave()
          // Save first, then onPublishDone is triggered only after save completes (via SAVE_PUBLISH_DONE)
          managerRef.savePublish(seedLocalId, publishProcess, { triggerPublishDone: true })
        } else {
          managerRef.savePublish(seedLocalId, publishProcess)
          startPeriodicSaveIfNeeded(snapshot)
        }
      }
    })

    receive(({ type }) => {
      if (type === 'UNSUBSCRIBE') {
        logger('Received UNSUBSCRIBE event')
        clearPeriodicSave()
        subscription.unsubscribe()
        managerRef?.removeSubscription(seedLocalId)
      }
    })
  }
)

import { EventObject, fromCallback, Subscription } from 'xstate'
import {
  DB_NAME_APP,
  DB_ON_SNAPSHOT,
  INTERNAL_LOADING_APP_DB_SUCCESS,
} from '@/browser/services/internal/constants'
import debug from 'debug'
import { FromCallbackInput, InternalMachineContext } from '@/types'

const logger = debug('app:services:internal:actors:loadAppDb')

export const loadAppDb = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  const { appDbService } = context

  let subscription: Subscription | undefined

  const _loadAppDb = async (): Promise<void> => {
    return new Promise((resolve) => {
      if (appDbService.getSnapshot().value === 'ready') {
        return resolve()
      }
      subscription = appDbService.subscribe({
        next: (snapshot) => {
          if (snapshot.value === 'ready') {
            return resolve()
          }

          sendBack({ type: DB_ON_SNAPSHOT, dbName: DB_NAME_APP, snapshot })
        },
      })
    })
  }

  _loadAppDb().then(() => {
    sendBack({ type: INTERNAL_LOADING_APP_DB_SUCCESS })
    logger('[sdk] [internal/actors] Successfully loaded app DB')
  })

  return () => {
    if (subscription) {
      subscription.unsubscribe()
    }
  }
})

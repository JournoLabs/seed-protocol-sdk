import { EventObject, fromCallback, Subscription } from 'xstate'
import {
  DB_NAME_APP,
  DB_ON_SNAPSHOT,
  INTERNAL_LOADING_APP_DB_SUCCESS,
} from '@/services/internal/constants'
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
    if (appDbService.getSnapshot().value === 'ready') {
      return
    }
    return new Promise((resolve) => {
      subscription = appDbService.subscribe((snapshot) => {
        if (snapshot.value === 'ready') {
          return resolve()
        }

        sendBack({ type: DB_ON_SNAPSHOT, dbName: DB_NAME_APP, snapshot })
      })
    })
  }

  _loadAppDb().then(() => {
    sendBack({ type: INTERNAL_LOADING_APP_DB_SUCCESS })
  })

  return () => {
    if (subscription) {
      subscription.unsubscribe()
    }
  }
})

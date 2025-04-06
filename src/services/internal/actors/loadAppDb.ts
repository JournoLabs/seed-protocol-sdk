import { EventObject, fromCallback, Subscription, waitFor } from 'xstate'
import {
  DB_NAME_APP,
  DB_ON_SNAPSHOT,
  INTERNAL_LOADING_APP_DB_SUCCESS,
} from '@/services/internal/constants'
import debug from 'debug'
import { FromCallbackInput, InternalMachineContext } from '@/types'

const logger = debug('seedSdk:services:internal:actors:loadAppDb')

export const loadAppDb = fromCallback<
  EventObject,
  FromCallbackInput<InternalMachineContext>
>(({ sendBack, input: { context } }) => {
  const { appDbService } = context

  let subscription: Subscription | undefined

  const _loadAppDb = async (): Promise<void> => {
    await waitFor(appDbService, (snapshot) => {
      return snapshot.value === 'ready'
    })
    sendBack({ type: DB_ON_SNAPSHOT, dbName: DB_NAME_APP, snapshot: appDbService.getSnapshot() })
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

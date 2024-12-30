import { EventObject, fromCallback, Subscription } from 'xstate'
import { isNode, isReactNative } from '@/shared'
import {
  GLOBAL_INITIALIZING_CREATE_ALL_ITEMS_SERVICES,
  GLOBAL_INITIALIZING_INTERNAL_SERVICE_READY,
  GLOBAL_INITIALIZING_SEND_CONFIG,
} from '@/services/internal/constants'
import debug from 'debug'
import { FromCallbackInput, GlobalMachineContext } from '@/types'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState } from '@/seedSchema'
import { like } from 'drizzle-orm'
import { fetchSchemaUids } from '@/stores/eas'

const logger = debug('app:services:global:actors:initialize')

export const initialize = fromCallback<
  EventObject,
  FromCallbackInput<GlobalMachineContext, EventObject>
>(({ sendBack, input: { event, context } }) => {
  const { internalService, models, endpoints, arweaveDomain } = context

  const { addresses } = event

  let environment = 'browser'

  if (isNode()) {
    environment = 'node'
  }

  if (isReactNative()) {
    environment = 'react-native'
  }

  let internalSubscription: Subscription | undefined
  let easSubscription: Subscription | undefined

  if (environment === 'browser' && models) {
    const _initFileSystem = async (): Promise<void> => {
      return
      // return new Promise((resolve) => {
      // })
    }

    const _initInternal = async (): Promise<void> => {
      return new Promise((resolve) => {
        internalSubscription = internalService.subscribe((snapshot) => {
          logger('[sdk] [internal] snapshot', snapshot)
          if (snapshot.value === 'ready') {
            resolve()
          }
        })
        internalService.send({
          type: 'init',
          endpoints,
          addresses,
          arweaveDomain,
        })
      })
    }

    const _initAllItemsServices = async (): Promise<void> => {
      const appDb = BaseDb.getAppDb()

      const rows = await appDb
        .select()
        .from(appState)
        .where(like(appState.key, 'snapshot__%'))

      const payloadObj = {
        create: {},
        restore: {},
      }

      const modelNamesRestored: string[] = []

      if (rows && rows.length > 0) {
        for (const row of rows) {
          const modelName = row.key.replace('snapshot__', '')
          payloadObj.restore[modelName] = JSON.parse(row.value)
          modelNamesRestored.push(modelName)
        }
      }
      for (const [modelName, ModelClass] of Object.entries(models)) {
        if (!modelNamesRestored.includes(modelName)) {
          payloadObj.create[modelName] = ModelClass
        }
      }
      sendBack({
        type: GLOBAL_INITIALIZING_CREATE_ALL_ITEMS_SERVICES,
        ...payloadObj,
      })
    }

    const _initEas = async (): Promise<void> => {
      await fetchSchemaUids()
    }

    _initFileSystem().then(() => {
      logger('[global/actors] File system initialized')
    })

    _initInternal()
      .then(() => {
        return _initAllItemsServices()
      })
      .then(() => {
        return _initEas()
      })
      .then(() => {
        logger('[global/actors] Internal initialized')
        sendBack({ type: GLOBAL_INITIALIZING_INTERNAL_SERVICE_READY })
        internalSubscription?.unsubscribe()
      })

    // _initEas().then(() => {
    //   logger('EAS initialized')
    // })
  }

  sendBack({ type: GLOBAL_INITIALIZING_SEND_CONFIG, environment })

  return () => {
    internalSubscription?.unsubscribe()
    easSubscription?.unsubscribe()
  }
})

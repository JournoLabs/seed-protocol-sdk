import { EventObject, fromCallback, Subscription, waitFor } from 'xstate'
import { getEnvironment } from '@/helpers/environment'
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

const logger = debug('seedSdk:services:global:actors:initialize')

export const initialize = fromCallback<
  EventObject,
  FromCallbackInput<GlobalMachineContext, EventObject>
>(({ sendBack, input: { event, context } }) => {
  const { internalService, models, endpoints, arweaveDomain, addresses, } = context

  if (!internalService) {
    throw new Error('internalService is required')
  }

  if (!models) {
    throw new Error('models is required')
  }

  const environment = getEnvironment()
  let easSubscription: Subscription | undefined

  const _initInternal = async (): Promise<void> => {
    internalService.send({
      type: 'init',
      endpoints,
      addresses,
      arweaveDomain,
    })
    await waitFor(internalService, (snapshot) => {
      logger('snapshot.value:', snapshot.value)
      return snapshot.value === 'ready'
    })
    logger('[sdk] [internal] sending init')
  }

  const _initAllItemsServices = async (): Promise<void> => {
    const appDb = BaseDb.getAppDb()

    const rows = await appDb
      .select()
      .from(appState)
      .where(like(appState.key, 'snapshot__%'))

    const payloadObj: {
      create: Record<string, any>,
      restore: Record<string, any>,
    } = {
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
    })


  sendBack({ type: GLOBAL_INITIALIZING_SEND_CONFIG, environment })

  return () => {
    easSubscription?.unsubscribe()
  }
})

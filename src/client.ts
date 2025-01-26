import { areFsListenersReady, setupFsListeners } from '@/events/files'
import { setupAllItemsEventHandlers } from '@/events'
import { setupServicesEventHandlers } from '@/services/events'
import { eventEmitter } from '@/eventBus'
import { globalService, } from '@/services'
import { ModelClassType, SeedConstructorOptions } from '@/types'
import {
  getModel,
  getModelNames,
  getModels,
  setModel,
} from '@/stores/modelClass'
import { setupServiceHandlers } from '@/events/services'
import { initArweaveClient, setArweaveDomain } from '@/helpers/ArweaveClient'
import { initItem } from './Item'
import { initItemProperty } from './ItemProperty'
import { initEasClient } from './helpers/EasClient'
import { initQueryClient } from './helpers/QueryClient'
import { initFileManager } from './helpers/FileManager'
import { initDb } from './db/Db'
import debug from 'debug'

const logger = debug('app:client')

const client = {
  isInitialized: false,
  init: async (options: SeedConstructorOptions) => {
    logger('init client')

    if (client.isInitialized) {
      return
    }

    client.isInitialized = true

    const { config, addresses } = options

    await initItem()
    await initItemProperty()
    await initEasClient()
    await initArweaveClient()
    await initQueryClient()
    await initFileManager()
    await initDb()

    const { endpoints, models, arweaveDomain, filesDir, } = config

    if (arweaveDomain) {
      setArweaveDomain(arweaveDomain)
    }

    for (const [key, value] of Object.entries(models)) {
      setModel(key, value)
    }
    setupFsListeners()
    setupAllItemsEventHandlers()
    setupServicesEventHandlers()
    setupServiceHandlers()
    if (areFsListenersReady()) {
      eventEmitter.emit('fs.init')
    }
    if (!areFsListenersReady()) {
      console.error('fs listeners not ready during init')
    }
    globalService.send({
      type: 'init',
      endpoints,
      models,
      addresses,
      arweaveDomain,
      filesDir,
    })

    const { models: internalModels } = await import('@/db/configs/seed.schema.config')
    for (const [key, value] of Object.entries(internalModels)) {
      setModel(key, value)
    }
  },
  subscribe: (callback: any) => {
    const subscription = globalService.subscribe(callback)

    eventEmitter.addListener('internal.globalService', callback)

    return {
      unsubscribe: () => {
        subscription.unsubscribe()
        eventEmitter.removeListener('internal.globalService', callback)
      },
    }
  },
  on: (outerEvent: string, callback: any) => {
    eventEmitter.addListener(outerEvent, callback)

    return {
      unsubscribe: () => {
        eventEmitter.removeListener(outerEvent, callback)
      },
    }
  },
  getSeedClass: async () => {
    return new Promise((resolve) => {
      const subscription = globalService.subscribe((snapshot) => {
        if (snapshot.status === 'done') {
          resolve(snapshot.output)
        }
      })

      globalService.send({ type: 'getSeed' })
      subscription.unsubscribe()
    })
  },
  getModel: (modelName: string) => {
    return getModel(modelName)
  },
  getModels: (): Record<string, ModelClassType> => {
    return getModels()
  },
  getModelNames: (): string[] => {
    return getModelNames()
  },
}

export { client }

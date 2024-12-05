import { areFsListenersReady, setupFsListeners } from '@/browser/events/files'
import { setupAllItemsEventHandlers } from '@/browser/events'
import { setupServicesEventHandlers } from '@/browser/services/events'
import { eventEmitter } from '@/eventBus'
import { globalService } from '@/browser/services'
import { ModelClassType, SeedConstructorOptions } from '@/types'
import {
  getModel,
  getModelNames,
  getModels,
  setModel,
} from '@/browser/stores/modelClass'
import { setupServiceHandlers } from '@/browser/events/services'

const client = {
  init: ({ config, addresses }: SeedConstructorOptions) => {
    const { endpoints, models } = config

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
    globalService.send({ type: 'init', endpoints, models, addresses })
    import('@/shared/configs/seed.schema.config').then(({ models }) => {
      for (const [key, value] of Object.entries(models)) {
        setModel(key, value)
      }
    })
  },
  subscribe: (callback: any) => {
    callback({
      type: '@xstate.snapshot',
      actorRef: globalService,
      snapshot: globalService.getSnapshot(),
    })
    eventEmitter.addListener('globalService', callback)

    return {
      unsubscribe: () => {
        eventEmitter.removeListener('globalService', callback)
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

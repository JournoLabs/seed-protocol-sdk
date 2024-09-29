import { isNode } from '@/shared/environment'
import { eventEmitter } from '@/eventBus'
import { SeedConstructorOptions, } from '@/types'
import { enableMapSet } from 'immer'
import { ModelClassType } from '@/types'
import { initSeedSync } from '@/init'

enableMapSet()

let withSeed

if (isNode()) {
  withSeed = initSeedSync()?.withSeed
}

const modelStore = new Map<string, ModelClassType>()

const client = {
  init: ({ config, addresses }: SeedConstructorOptions) => {
    const { endpoints, models } = config
    for (const [key, value] of Object.entries(models)) {
      modelStore.set(key, value)
    }
    setupFsListeners()
    setupAllItemsEventHandlers()
    setupServicesEventHandlers()
    setupPropertyEventHandlers()
    if (areFsListenersReady()) {
      eventEmitter.emit('fs.init')
    }
    if (!areFsListenersReady()) {
      console.error('fs listeners not ready during init')
    }
    globalService.send({ type: 'init', endpoints, models, addresses })
    import('@/shared/configs/seed.schema.config').then(({ models }) => {
      for (const [key, value] of Object.entries(models)) {
        modelStore.set(key, value)
      }
    })
  },
  }

export { withSeed, client }

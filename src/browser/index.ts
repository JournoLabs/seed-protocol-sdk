import { eventEmitter } from '@/eventBus'
import debug from 'debug'

export * from './db/Db'
export * from './react'
export * from './Item'
export * from './ItemProperty'

const logger = debug('seedSdk:browser:index')

eventEmitter.on('file-saved', (filePath) => {
  const worker = new Worker('./workers/image-resize.ts?worker')

  logger('file-saved', filePath)
  worker.postMessage({
    type: 'resize',
    filePath,
  })
})

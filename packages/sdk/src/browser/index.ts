import { eventEmitter } from '@/eventBus'
import debug from 'debug'

export * from './db/Db'

// Initialize PathResolver for browser
import './helpers/PathResolver'

const logger = debug('seedSdk:browser:index')

eventEmitter.on('file-saved', (filePath) => {
  const worker = new Worker('./workers/image-resize.ts?worker')

  logger('file-saved', filePath)
  worker.postMessage({
    type: 'resize',
    filePath,
  })
})

import { eventEmitter } from '@/eventBus'

export * from './db'
export * from './react'
export * from './Item'
export * from './ItemProperty'


eventEmitter.on('file-saved', (filePath) => {
  const worker = new Worker('./workers/image-resize.ts?worker')

  console.log('file-saved', filePath)
  worker.postMessage({
    type: 'resize',
    filePath,
  })
})

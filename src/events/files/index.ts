import { eventEmitter }                                                          from '@/eventBus'
import { downloadAllFilesBinaryRequestHandler, downloadAllFilesRequestHandler } from './download'
import { BaseFileManager }                                                       from '@/helpers'
import { isBrowser } from '@/helpers/environment'


let isInitialized = false


const fsInitHandler = async () => {
  if ( isInitialized ) {
    eventEmitter.emit('fs.init.response', { success: true })
    return
  }

  try {

    // console.log('fsInitHandler isBrowser', isBrowser())

    // console.log({
    //   environment: process.env.NEXT_RUNTIME || 'unknown',
    //   isServer: typeof window === 'undefined',
    //   nodeEnv: process.env.NODE_ENV,
    //   // Log what's available in global scope
    //   hasWindow: typeof window !== 'undefined',
    //   hasDocument: typeof document !== 'undefined',
    // })

    if (
      isBrowser()
    ) {
      const FileManager = (await import('../../browser/helpers/FileManager')).FileManager
      BaseFileManager.setPlatformClass(FileManager)
    }

    // if (!isBrowser()) {
    //   await import('@/node/helpers/FileManager')
    // }

    await BaseFileManager.initializeFileSystem()

    isInitialized = true

    eventEmitter.emit('fs.init.response', { success: true })
  } catch ( e ) {
    if ( !isInitialized ) {
      console.error('[fs.init] error initializing fs', e)
      eventEmitter.emit('fs.init.response', {
        success: false,
        error: e,
      })
    }
    // TODO: We can ignore this for now but should figure out if this is being called excessively
  }
}

let areReady = false

export const setupFsListeners = () => {
  eventEmitter.addListener(
    'fs.downloadAll.request',
    downloadAllFilesRequestHandler,
  )
  eventEmitter.addListener(
    'fs.downloadAllBinary.request',
    downloadAllFilesBinaryRequestHandler,
  )
  eventEmitter.addListener('fs.init', fsInitHandler)
  areReady = true
}

export const areFsListenersReady = () => {
  return areReady
}

export const isFsInitialized = () => {
  return isInitialized
}

import { eventEmitter } from '@/eventBus'
import { configureSingle } from '@zenfs/core'
import { WebAccess } from '@zenfs/dom'
import {
  downloadAllFilesBinaryRequestHandler,
  downloadAllFilesRequestHandler,
} from './download'

let isInitialized = false

const fsInitHandler = async (_) => {
  if (isInitialized) {
    eventEmitter.emit('fs.init.response', { success: true })
    return
  }

  try {
    const handle = await navigator.storage.getDirectory()
    // await configure({ backend: WebAccess, handle })
    await configureSingle({
      backend: WebAccess,
      handle,
    })

    isInitialized = true

    eventEmitter.emit('fs.init.response', { success: true })
  } catch (e) {
    if (!isInitialized) {
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

import { eventEmitter }                                                          from '@/eventBus'
import { downloadAllFilesBinaryRequestHandler, downloadAllFilesRequestHandler } from './download'

let isInitialized = false

const fsInitHandler = async () => {
  if ( isInitialized ) {
    return
  }

  isInitialized = true

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

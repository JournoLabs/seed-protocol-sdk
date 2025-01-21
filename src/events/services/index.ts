import { eventEmitter } from '@/eventBus'
import { saveServiceHandler } from './allItems'

let areReady = false

export const setupServiceHandlers = () => {
  eventEmitter.addListener('service.save', saveServiceHandler)
  areReady = true
}

export const getAreServiceHandlersReady = () => {
  return areReady
}

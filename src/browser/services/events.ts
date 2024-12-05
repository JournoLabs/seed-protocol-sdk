import { eventEmitter } from '@/eventBus'
import debug from 'debug'

const logger = debug('app:services:events')

const handleServiceSaveState = (event: any) => {
  const { state, serviceId } = event
  logger(`[browser] [service.saveState.request] serviceId: ${serviceId}`)
  localStorage.setItem(`seed_sdk_service_${serviceId}`, JSON.stringify(state))
}

export const setupServicesEventHandlers = () => {
  eventEmitter.addListener('service.saveState.request', handleServiceSaveState)
}

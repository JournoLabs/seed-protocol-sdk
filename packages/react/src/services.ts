import { useCallback, useEffect, useState } from 'react'
import { ActorRef } from 'xstate'
import pluralize from 'pluralize'
import { useSelector } from '@xstate/react'
import debug from 'debug'
import { ClientManagerState, getClient } from '@seedprotocol/sdk'
import { isDbReadyState } from './db'

const logger = debug('seedSdk:react:services')

const finalStrings = ['idle', 'ready', 'done', 'success', 'initialized']

export const getServiceName = (service: ActorRef<any, any>) => {
  let name = 'actor'
  const serviceAny = service as any
  if (service && serviceAny.uniqueKey) {
    name = serviceAny.uniqueKey
  }
  if (service && !serviceAny.uniqueKey && serviceAny.logic && serviceAny.logic.config) {
    name = getServiceUniqueKey(service)
  }
  return name
}

export const getServiceValue = (
  service: ActorRef<any, any>,
): string | undefined => {
  let value
  if (service && service.getSnapshot() && service.getSnapshot().value) {
    value = service.getSnapshot().value
  }
  if (getServiceName(service) === 'global') {
    if (
      value &&
      typeof value === 'object' &&
      Object.keys(value).length > 0 &&
      Object.keys(value)[0] === 'initialized'
    ) {
      value = 'ready'
    }
  }
  if (value && typeof value === 'object') {
    value = JSON.stringify(value)
  }
  return value
}

export const getServiceUniqueKey = (service: ActorRef<any, any>) => {
  const serviceAny = service as any
  if (!service || !serviceAny.logic || !serviceAny.logic.config || !serviceAny._snapshot) {
    return
  }
  const config = serviceAny.logic.config
  if (!config.id) {
    return
  }
  let uniqueKey = config.id
  if (config.id.includes('@seedSdk/')) {
    uniqueKey = config.id.match(/^.*@seedSdk\/(\w+)[\.\w]*/)[1]
  }
  let snapshot
  try {
    snapshot = service.getSnapshot()
  } catch (error) {
    logger('Error:', error)
    return uniqueKey
  }
  if (snapshot) {
    const context = snapshot.context
    if (context && context.dbName) {
      uniqueKey = context.dbName
    }
    if (context && context.modelNamePlural) {
      uniqueKey = context.modelNamePlural
    }
    if (context && context.modelName) {
      uniqueKey = pluralize(context.modelName.toLowerCase())
    }
  }
  return uniqueKey
}

export const useService = (service: ActorRef<any, any>) => {
  const [timeElapsed, setTimeElapsed] = useState(0)

  const getPercentComplete = (service: ActorRef<any, any>) => {
    let percentComplete = 0
    const serviceAny = service as any
    if (serviceAny.logic?.states) {
      const stateNames: string[] = []
      const startupStates: any[] = []

      for (const [stateName, state] of Object.entries(serviceAny.logic.states)) {
        const stateTyped = state as { tags?: string[] }
        if (stateTyped.tags?.includes('loading')) {
          stateNames.push(stateName)
          startupStates.push(state)
        }
      }

      const totalStates = startupStates.length
      const value = getServiceValue(service)
      if (value && finalStrings.includes(value)) {
        return 0
      }
      if (value) {
        const stateIndex = stateNames.indexOf(value)
        percentComplete = (stateIndex / totalStates) * 100
      }
    }
    return percentComplete
  }

  const updateTime = useCallback(
    (interval: ReturnType<typeof setInterval>) => {
      const status = service.getSnapshot().value
      if (
        status === 'done' ||
        status === 'success' ||
        status === 'idle' ||
        status === 'ready'
      ) {
        clearInterval(interval)
        return
      }
      setTimeElapsed((timeElapsed) => timeElapsed + 1)
    },
    [service],
  )

  const startInterval = useCallback(() => {
    const interval = setInterval(() => {
      updateTime(interval)
    }, 1000)
    return interval
  }, [updateTime, service])

  useEffect(() => {
    const interval = startInterval()
    return () => clearInterval(interval)
  }, [])

  return {
    name: getServiceName(service),
    timeElapsed,
    value: getServiceValue(service),
    percentComplete: getPercentComplete(service),
    uniqueKey: getServiceUniqueKey(service),
  }
}

/** Whether the app database is open (see useDbsAreReady). */
export const useIsDbReady = () => {
  const { internalStatus } = useGlobalServiceStatus()
  return internalStatus === 'ready'
}

/**
 * @deprecated Does nothing: actor snapshots were never written, and loaded ones were discarded.
 * Will be removed.
 */
export const usePersistedSnapshots = () => {}

/**
 * @deprecated Always false: nothing writes snapshot rows. Will be removed.
 */
export const useHasSavedSnapshots = () => false

const percentForClientState = (state: unknown): number => {
  switch (state) {
    case ClientManagerState.IDLE:
      return 100
    case ClientManagerState.ADD_MODELS_TO_DB:
      return 90
    case ClientManagerState.ADD_MODELS_TO_STORE:
      return 80
    case ClientManagerState.PROCESS_SCHEMA_FILES:
      return 70
    case ClientManagerState.SAVE_CONFIG:
      return 60
    case ClientManagerState.DB_INIT:
      return 50
    case ClientManagerState.FILE_SYSTEM_INIT:
      return 30
    case ClientManagerState.PLATFORM_CLASSES_INIT:
      return 10
    default:
      return 0
  }
}

export const useServices = () => {
  const [actors, setActors] = useState<ActorRef<any, any>[]>([])
  // From the current state: subscribe() doesn't replay it, so an already-idle client stayed at 5.
  const [percentComplete, setPercentComplete] = useState(() =>
    percentForClientState(getClient().getService().getSnapshot().value),
  )

  // Global service removed - now track ClientManager directly
  useEffect(() => {
    const clientManager = getClient()
    const clientService = clientManager.getService()
    
    // Add ClientManager to actors list
    const clientActor = clientService as any
    clientActor.uniqueKey = 'clientManager'
    
    setActors([clientActor])
    
    setPercentComplete(percentForClientState(clientService.getSnapshot().value))
    const subscription = clientService.subscribe((snapshot) => {
      setPercentComplete(percentForClientState(snapshot.value))
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return {
    services: actors,
    percentComplete,
  }
}

export const useGlobalServiceStatus = () => {
  const clientManager = getClient()
  const clientService = clientManager.getService()

  const status = useSelector(clientService, (snapshot) => {
    return snapshot.value
  })

  // 'ready' while the app database is open (see isDbReadyState), otherwise the client state.
  const internalStatus = useSelector(clientService, (snapshot) =>
    isDbReadyState(snapshot.value) ? 'ready' : snapshot.value,
  )

  return {
    status,
    internalStatus,
  }
}

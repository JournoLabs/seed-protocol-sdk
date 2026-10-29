import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ActorRef } from 'xstate'
import pluralize from 'pluralize'
import debug from 'debug'
import { ClientManagerState, MachineIds } from '@seedprotocol/sdk'
import { isDbReadyState } from './db'
import { useClientSelector, useClientService } from './client'

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

const isClientManagerService = (service: ActorRef<any, any>): boolean =>
  (service as any)?.logic?.config?.id === MachineIds.CLIENT_MANAGER

/**
 * 100 once the service reaches a final state ('idle', 'ready', ...). During startup, the client
 * manager's progress through init, or the current state's position among the `loading`-tagged
 * states for other services. 0 when there's nothing to measure.
 */
export const getPercentComplete = (service: ActorRef<any, any>): number => {
  const snapshot = service?.getSnapshot()
  if (isClientManagerService(service)) {
    return snapshot?.status === 'active' ? percentForClientState(snapshot.value) : 0
  }
  const value = getServiceValue(service)
  if (value && finalStrings.includes(value)) {
    return 100
  }
  const states = (service as any)?.logic?.states
  if (!value || !states) {
    return 0
  }
  const loadingStateNames = Object.entries(states)
    .filter(([, state]) => (state as { tags?: string[] }).tags?.includes('loading'))
    .map(([stateName]) => stateName)
  const stateIndex = loadingStateNames.indexOf(value)
  if (stateIndex < 0) {
    return 0
  }
  return (stateIndex / loadingStateNames.length) * 100
}

export const useService = (service: ActorRef<any, any>) => {
  const [timeElapsed, setTimeElapsed] = useState(0)

  // Re-render on state changes, not only on the timer below.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = service.subscribe({ next: onChange, error: onChange, complete: onChange })
      return () => subscription.unsubscribe()
    },
    [service],
  )
  const getValue = () => getServiceValue(service)
  const value = useSyncExternalStore(subscribe, getValue, getValue)

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
    value,
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
  const clientService = useClientService()
  const percentComplete = useClientSelector((snapshot) =>
    snapshot.status === 'active' ? percentForClientState(snapshot.value) : 0,
  )
  const services = useMemo(() => {
    ;(clientService as any).uniqueKey = 'clientManager'
    return [clientService as ActorRef<any, any>]
  }, [clientService])

  return {
    services,
    percentComplete,
  }
}

/**
 * The client manager's state. `'stopped'` after `client.stop()` until the next init starts: a stopped
 * actor keeps its last state (`'idle'`), which would read as ready.
 */
export const useGlobalServiceStatus = (): {
  status: ClientManagerState | 'stopped'
  internalStatus: ClientManagerState | 'ready' | 'stopped'
} => {
  const status = useClientSelector((snapshot): ClientManagerState | 'stopped' =>
    snapshot.status === 'active' ? (snapshot.value as ClientManagerState) : 'stopped',
  )

  // 'ready' while the app database is open (see isDbReadyState), otherwise the client state.
  const internalStatus = useClientSelector((snapshot): ClientManagerState | 'ready' | 'stopped' =>
    snapshot.status !== 'active'
      ? 'stopped'
      : isDbReadyState(snapshot.value)
        ? 'ready'
        : (snapshot.value as ClientManagerState),
  )

  return {
    status,
    internalStatus,
  }
}

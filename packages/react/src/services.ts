import { useCallback, useEffect, useState } from 'react'
import { ActorRef, InspectedEventEvent } from 'xstate'
import { orderBy } from 'lodash-es'
import { produce } from 'immer'
import { eventEmitter } from '@seedprotocol/sdk'
import pluralize from 'pluralize'
import { useSelector } from '@xstate/react'
import debug from 'debug'
import { appState } from '@seedprotocol/sdk'
import { like } from 'drizzle-orm'
import { BaseDb, MachineIds, ClientManagerState, getClient } from '@seedprotocol/sdk'

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
      const context = service.getSnapshot().context
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

export const useIsDbReady = () => {
  const [isDbReady, setIsDbReady] = useState(false)

  const { internalStatus } = useGlobalServiceStatus()

  useEffect(() => {
    if (internalStatus === 'ready') {
      setIsDbReady(true)
    }
  }, [internalStatus])

  useEffect(() => {
    if (internalStatus === 'ready') {
      setIsDbReady(true)
    }
  }, [])
  

  return isDbReady
}

export const usePersistedSnapshots = () => {
  const [initialized, setInitialized] = useState(false)

  const hasSavedSnapshots = useHasSavedSnapshots()

  const { services, percentComplete } = useServices()

  // Helper function to save all actor snapshots to the database
  const save = useCallback(async () => {
    for (const actor of services) {
      const uniqueKey = getServiceUniqueKey(actor)
      logger(
        `would save to db with snapshot__${uniqueKey}:`,
        JSON.stringify(actor.getPersistedSnapshot()),
      )
      // await writeAppState(
      //   `snapshot__${uniqueKey}`,
      //   JSON.stringify(actor.getPersistedSnapshot()),
      // )
    }
  }, [services])

  // Helper function to load persisted snapshots from the database
  const load = useCallback(async () => {
    const appDb = BaseDb.getAppDb()

    if (!appDb) {
      return []
    }

    const persistedSnapshots = await appDb
      .select()
      .from(appState)
      .where(like(appState.key, 'snapshot__%'))
    return persistedSnapshots
  }, [])

  useEffect(() => {
    if (!hasSavedSnapshots || initialized) {
      return
    }
    const initialize = async () => {
      const persistedSnapshots = await load()
      logger('persistedSnapshots:', persistedSnapshots)
      setInitialized(true)
    }

    initialize()

    return () => {
      save() // Save snapshots on unmount
    }
  }, [hasSavedSnapshots, initialized])
}

export const useHasSavedSnapshots = () => {
  const [hasSavedSnapshots, setHasSavedSnapshots] = useState(false)

  const isDbReady = useIsDbReady()

  useEffect(() => {
    if (isDbReady) {
      const _checkForSnapshots = async (): Promise<void> => {
        const appDb = BaseDb.getAppDb()

        const rows = await appDb
          .select()
          .from(appState)
          .where(like(appState.key, 'snapshot__%'))

        if (rows && rows.length > 0) {
          setHasSavedSnapshots(true)
        }
      }

      _checkForSnapshots()
    }
  }, [isDbReady])

  return hasSavedSnapshots
}

export const useServices = () => {
  const [actors, setActors] = useState<ActorRef<any, any>[]>([])
  const [percentComplete, setPercentComplete] = useState(5)

  // Global service removed - now track ClientManager directly
  useEffect(() => {
    const clientManager = getClient()
    const clientService = clientManager.getService()
    
    // Add ClientManager to actors list
    const clientActor = clientService as any
    clientActor.uniqueKey = 'clientManager'
    
    setActors([clientActor])
    
    // Calculate percent complete based on ClientManager state
    const subscription = clientService.subscribe((snapshot) => {
      const state = snapshot.value
      // Calculate completion based on state progression
      let percent = 0
      if (state === ClientManagerState.IDLE) {
        percent = 100
      } else if (state === ClientManagerState.ADD_MODELS_TO_DB) {
        percent = 90
      } else if (state === ClientManagerState.ADD_MODELS_TO_STORE) {
        percent = 80
      } else if (state === ClientManagerState.PROCESS_SCHEMA_FILES) {
        percent = 70
      } else if (state === ClientManagerState.SAVE_CONFIG) {
        percent = 60
      } else if (state === ClientManagerState.DB_INIT) {
        percent = 50
      } else if (state === ClientManagerState.FILE_SYSTEM_INIT) {
        percent = 30
      } else if (state === ClientManagerState.PLATFORM_CLASSES_INIT) {
        percent = 10
      }
      setPercentComplete(percent)
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

  // Internal service functionality is now part of ClientManager
  // DB is ready when ClientManager reaches DB_INIT or later states
  const internalStatus = useSelector(clientService, (snapshot) => {
    const state = snapshot.value
    if (state === ClientManagerState.DB_INIT || 
        state === ClientManagerState.SAVE_CONFIG ||
        state === ClientManagerState.PROCESS_SCHEMA_FILES ||
        state === ClientManagerState.ADD_MODELS_TO_STORE ||
        state === ClientManagerState.ADD_MODELS_TO_DB ||
        state === ClientManagerState.IDLE) {
      return 'ready'
    }
    return state
  })

  return {
    status,
    internalStatus,
  }
}

import { useCallback, useEffect, useState } from 'react'
import { ActorRef } from 'xstate'
import { orderBy } from 'lodash-es'
import { produce } from 'immer'
import { eventEmitter } from '@/eventBus'
import pluralize from 'pluralize'
import { getGlobalService } from '@/browser/services/global'
import { useSelector } from '@xstate/react'
import debug from 'debug'
import { appState } from '@/shared/seedSchema'
import { like } from 'drizzle-orm'
import { getAppDb } from '@/browser/db/sqlWasmClient'
import { MachineIds } from '@/browser/services/internal/constants'

const logger = debug('app:react:services')

const finalStrings = ['idle', 'ready', 'done', 'success', 'initialized']

export const getServiceName = (service: ActorRef<any, any>) => {
  let name = 'actor'
  if (service && service.uniqueKey) {
    name = service.uniqueKey
  }
  if (service && !service.uniqueKey && service.logic && service.logic.config) {
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
  if (!service || !service.logic || !service.logic.config) {
    return
  }
  const config = service.logic.config
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
    if (service.logic.states) {
      const stateNames = []
      const startupStates = []

      for (const [stateName, state] of Object.entries(service.logic.states)) {
        if (state.tags.includes('loading')) {
          stateNames.push(stateName)
          startupStates.push(state)
        }
      }

      const totalStates = startupStates.length
      const value = getServiceValue(service)
      if (finalStrings.includes(value)) {
        return 0
      }
      const stateIndex = stateNames.indexOf(value)
      percentComplete = (stateIndex / totalStates) * 100
    }
    return percentComplete
  }

  const updateTime = useCallback(
    (interval) => {
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
      console.log(
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
    const appDb = getAppDb()

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
      console.log('persistedSnapshots:', persistedSnapshots)
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
        const appDb = getAppDb()

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

  const actorsMap = new Map<string, ActorRef<any, any>>()

  useEffect(() => {
    const globalServiceListener = (event) => {
      if (event && event.type === 'init') {
        return
      }
      if (
        event.actorRef &&
        event.actorRef.logic &&
        event.actorRef.logic.config
      ) {
        const service = event.actorRef
        const services = [service]

        if (service.logic.config.id === MachineIds.GLOBAL) {
          const context = service.getSnapshot().context
          const keys = Object.keys(context)
          for (const key of keys) {
            if (!key.startsWith('internal') && key.endsWith('Service')) {
              const allItemsService = context[key]
              services.push(allItemsService)
            }
          }
        }

        services.forEach((innerService) => {
          const uniqueKey = getServiceUniqueKey(innerService)
          if (!uniqueKey) {
            return
          }
          innerService.uniqueKey = uniqueKey
          actorsMap.set(uniqueKey, innerService)
        })

        let actorsArray = Array.from(actorsMap.values())
        actorsArray = orderBy(actorsArray, (a) => a.logic.config.id, ['asc'])

        setActors(
          produce(actors, (draft) => {
            return actorsArray
          }),
        )
      }
    }

    eventEmitter.addListener('inspect.globalService', globalServiceListener)

    return () => {
      eventEmitter.removeListener(
        'inspect.globalService',
        globalServiceListener,
      )
    }
  }, [])

  useEffect(() => {
    const globalService = actors.find(
      (actor) => getServiceName(actor) === 'global',
    )
    const internalService = actors.find(
      (actor) => getServiceName(actor) === 'internal',
    )
    if (!globalService || !internalService) {
      return
    }
    if (
      getServiceValue(globalService) === 'initialized' &&
      getServiceValue(internalService) === 'ready'
    ) {
      const denominator = actors.length
      const finishedActors = actors.filter((actor) => {
        const value = getServiceValue(actor)
        return finalStrings.includes(value)
      })
      const numerator = finishedActors.length
      const percentComplete = (numerator / denominator) * 100
      setPercentComplete(percentComplete)
    }
  }, [actors])

  return {
    services: actors,
    percentComplete,
  }
}

export const useGlobalServiceStatus = () => {
  const globalService = getGlobalService()

  const status = useSelector(globalService, (snapshot) => {
    return snapshot.value
  })

  const internalStatus = useSelector(
    globalService.getSnapshot().context.internalService,
    (snapshot) => {
      if (!snapshot) {
        return
      }
      return snapshot.value
    },
  )

  const internalService = useSelector(globalService, (snapshot) => {
    return snapshot.context.internalService
  })

  return {
    status,
    internalStatus,
  }
}

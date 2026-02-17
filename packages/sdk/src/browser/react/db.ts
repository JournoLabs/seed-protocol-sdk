import { useCallback, useEffect, useState } from 'react'
import { Subscription } from 'xstate'
import { getClient } from '@/client/ClientManager'
import { ClientManagerState } from '@/client/constants'
import debug from 'debug'

const logger = debug('seedSdk:react:db')

export const useDbsAreReady = () => {
  const [dbsAreReady, setDbsAreReady] = useState(false)

  const update = useCallback(() => {
    if (dbsAreReady) {
      return
    }
    setDbsAreReady(true)
  }, [])

  useEffect(() => {
    let subscription: Subscription | undefined

    const _waitForDbs = async (): Promise<void> => {
      const clientManager = getClient()
      const clientService = clientManager.getService()
      
      const currentState = clientService.getSnapshot().value
      // DB is ready when ClientManager reaches DB_INIT state or later
      if (currentState === ClientManagerState.DB_INIT || 
          currentState === ClientManagerState.SAVE_CONFIG ||
          currentState === ClientManagerState.PROCESS_SCHEMA_FILES ||
          currentState === ClientManagerState.ADD_MODELS_TO_STORE ||
          currentState === ClientManagerState.ADD_MODELS_TO_DB ||
          currentState === ClientManagerState.IDLE) {
        update()
        return
      }
      
      subscription = clientService.subscribe((snapshot) => {
        const state = snapshot.value
        if (state === ClientManagerState.DB_INIT || 
            state === ClientManagerState.SAVE_CONFIG ||
            state === ClientManagerState.PROCESS_SCHEMA_FILES ||
            state === ClientManagerState.ADD_MODELS_TO_STORE ||
            state === ClientManagerState.ADD_MODELS_TO_DB ||
            state === ClientManagerState.IDLE) {
          update()
          subscription?.unsubscribe()
        }
      })
    }

    _waitForDbs()

    return () => {
      if (subscription) {
        subscription.unsubscribe()
      }
    }
  }, [])

  return {
    dbsAreReady,
  }
}

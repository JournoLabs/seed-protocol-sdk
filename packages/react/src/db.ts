import { useSelector } from '@xstate/react'
import { getClient, ClientManagerState } from '@seedprotocol/sdk'

/**
 * Client states in which the app database is open: DB_INIT finishes with dbReady and moves to
 * SAVE_CONFIG. DB_INIT itself (still opening, may fail) and INIT_FAILED are not ready.
 */
const DB_READY_STATES = new Set<string>([
  ClientManagerState.SAVE_CONFIG,
  ClientManagerState.PROCESS_SCHEMA_FILES,
  ClientManagerState.ADD_MODELS_TO_STORE,
  ClientManagerState.ADD_MODELS_TO_DB,
  ClientManagerState.IDLE,
])

export const isDbReadyState = (state: unknown): boolean =>
  typeof state === 'string' && DB_READY_STATES.has(state)

/**
 * Whether the app database is open. True once the client has opened it, false again if init
 * fails or restarts.
 */
export const useDbsAreReady = () => {
  const dbsAreReady = useSelector(getClient().getService(), (snapshot) => isDbReadyState(snapshot.value))
  return {
    dbsAreReady,
  }
}

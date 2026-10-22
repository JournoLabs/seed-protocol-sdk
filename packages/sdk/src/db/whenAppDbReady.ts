import { waitFor } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { ClientManagerState } from '@/client/constants'

// Client states in which the app database is open: dbInit finishes before saveConfig starts.
const DB_OPEN_STATES = new Set<string>([
  ClientManagerState.SAVE_CONFIG,
  ClientManagerState.PROCESS_SCHEMA_FILES,
  ClientManagerState.ADD_MODELS_TO_DB,
  ClientManagerState.IDLE,
])

/**
 * The app database, once client init has opened it. Waits up to `timeoutMs` for init to get that
 * far; returns undefined when it doesn't (no init, a failed or stopped client).
 */
export async function whenAppDbReady(timeoutMs = 30_000): Promise<ReturnType<typeof BaseDb.getAppDb> | undefined> {
  if (BaseDb.isAppDbReady()) return BaseDb.getAppDb()
  // Imported here: the client imports most of the SDK
  const { getClient } = await import('@/client/ClientManager')
  try {
    await waitFor(
      getClient().getService(),
      (snapshot) => DB_OPEN_STATES.has(snapshot.value as string),
      { timeout: timeoutMs },
    )
  } catch {
    return undefined
  }
  return BaseDb.getAppDb()
}

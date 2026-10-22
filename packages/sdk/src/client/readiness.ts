import { waitFor } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { ClientManagerState } from '@/client/constants'

/** The parts of the clientManager actor readiness reads. */
type ClientSnapshot = { status: string; value: unknown }
type ClientActor = Parameters<typeof waitFor>[0] & { getSnapshot(): ClientSnapshot }

// Set by ClientManager when it loads. Importing it here would pull in most of the SDK, and
// readiness is read from inside that graph (entity loads, downloads).
let getClientActor: (() => ClientActor) | undefined

/** @internal ClientManager registers the getter for its current actor (init after stop replaces it). */
export function registerClientActor(getter: () => ClientActor): void {
  getClientActor = getter
}

// Client states in which the app database is open: dbInit finishes before saveConfig starts.
const DB_OPEN_STATES = new Set<string>([
  ClientManagerState.SAVE_CONFIG,
  ClientManagerState.PROCESS_SCHEMA_FILES,
  ClientManagerState.ADD_MODELS_TO_DB,
  ClientManagerState.IDLE,
])

/** Whether a clientManager snapshot is a running client that finished init. */
export function isClientReadySnapshot(snapshot: ClientSnapshot): boolean {
  return snapshot.status === 'active' && snapshot.value === ClientManagerState.IDLE
}

/**
 * Whether `client.init` finished and the app database is open. False before init, while it runs,
 * and after `client.stop()`.
 */
export function isClientReady(): boolean {
  const actor = getClientActor?.()
  return !!actor && isClientReadySnapshot(actor.getSnapshot()) && BaseDb.isAppDbReady()
}

/**
 * The app database, once client init has opened it. Waits up to `timeoutMs` for init to get that
 * far; returns undefined when it doesn't (no init, a failed or stopped client).
 */
export async function whenDbReady(timeoutMs = 30_000): Promise<ReturnType<typeof BaseDb.getAppDb> | undefined> {
  if (BaseDb.isAppDbReady()) return BaseDb.getAppDb()
  const actor = getClientActor?.()
  if (!actor) return undefined
  try {
    await waitFor(actor, (snapshot) => DB_OPEN_STATES.has((snapshot as ClientSnapshot).value as string), {
      timeout: timeoutMs,
    })
  } catch {
    return undefined
  }
  return BaseDb.isAppDbReady() ? BaseDb.getAppDb() : undefined
}

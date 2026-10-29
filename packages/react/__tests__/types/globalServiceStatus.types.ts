/**
 * Compile-time checks for useGlobalServiceStatus; never executed.
 * Checked by `tsc -p packages/react/tsconfig.typetests.json` (part of `bun run test`).
 *
 * `status` was typed `string`, so a switch on it lost its exhaustiveness check.
 */
import { ClientManagerState } from '@seedprotocol/sdk'
import { useGlobalServiceStatus } from '../../src/services'

export function describeStatus(): string {
  const { status } = useGlobalServiceStatus()
  switch (status) {
    case 'stopped':
      return 'stopped'
    case ClientManagerState.IDLE:
      return 'ready'
    case ClientManagerState.INIT_FAILED:
      return 'failed'
    case ClientManagerState.UNINITIALIZED:
    case ClientManagerState.PLATFORM_CLASSES_INIT:
    case ClientManagerState.FILE_SYSTEM_INIT:
    case ClientManagerState.DB_INIT:
    case ClientManagerState.SAVE_CONFIG:
    case ClientManagerState.ADD_MODELS_TO_DB:
    case ClientManagerState.PROCESS_SCHEMA_FILES:
      return 'starting'
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}

export function internalStatus() {
  const { internalStatus } = useGlobalServiceStatus()
  const known: ClientManagerState | 'ready' | 'stopped' = internalStatus
  // @ts-expect-error not a client state
  if (internalStatus === 'loading') return known
  return known
}

export function stopReason() {
  const { stopReason } = useGlobalServiceStatus()
  const known: 'stop' | 'reset' | undefined = stopReason
  // @ts-expect-error not a stop reason
  if (stopReason === 'failed') return known
  return known
}

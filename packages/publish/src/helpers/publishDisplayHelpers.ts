import { PublishMachineStates } from '~/helpers/constants'

/**
 * Maps internal publish machine state values to display step IDs for UI consistency.
 * The direct-EAS path uses `creatingAttestationsDirectToEas` internally, but UIs
 * typically show a single "Creating attestations" step. This helper normalizes the
 * machine value for display.
 */
export function getDisplayStepId(machineValue: string): string {
  if (machineValue === 'creatingAttestationsDirectToEas') {
    return 'creatingAttestations'
  }
  return machineValue
}

type PublishRowStatus = 'in_progress' | 'completed' | 'failed' | 'interrupted'

/**
 * Single source of truth for step UIs: the live machine while running; once the
 * actor is gone, prefer the DB row status so we never flash an intermediate
 * `persistedSnapshot` value (e.g. creatingAttestations) after a completed run.
 */
export function resolvePublishDisplayValue(
  publishProcess: unknown | null | undefined,
  record: { status: PublishRowStatus } | undefined,
  machineValue: string | undefined
): string | undefined {
  if (publishProcess != null) return machineValue
  if (record?.status === 'completed') return PublishMachineStates.SUCCESS
  if (record?.status === 'failed') return PublishMachineStates.FAILURE
  return machineValue
}

export type PublishRowForDisplay = {
  status: string
  persistedSnapshot: string
  completedAt?: number | null
}

/**
 * Derives the machine-state string for UI from the persisted DB row. Prefer
 * `status` / `completedAt` over raw `persistedSnapshot` JSON so a stale or
 * out-of-order snapshot write cannot force the UI back to an intermediate step
 * after a terminal save (common when consumers read `JSON.parse(persistedSnapshot).value`).
 */
export function getPublishMachineValueForUi(record: PublishRowForDisplay | undefined): string | undefined {
  if (!record) return undefined

  if (record.status === 'failed') return PublishMachineStates.FAILURE
  if (record.status === 'completed') return PublishMachineStates.SUCCESS

  if (record.completedAt != null) {
    try {
      const p = JSON.parse(record.persistedSnapshot) as { value?: unknown; status?: string }
      if (p.status === 'done' && p.value === PublishMachineStates.FAILURE) {
        return PublishMachineStates.FAILURE
      }
    } catch {
      /* ignore */
    }
    return PublishMachineStates.SUCCESS
  }

  try {
    const p = JSON.parse(record.persistedSnapshot) as { value?: unknown; status?: string }
    if (p.status === 'done') {
      if (p.value === PublishMachineStates.SUCCESS) return PublishMachineStates.SUCCESS
      if (p.value === PublishMachineStates.FAILURE) return PublishMachineStates.FAILURE
    }
    if (typeof p.value === 'string') return p.value
  } catch {
    return undefined
  }
  return undefined
}

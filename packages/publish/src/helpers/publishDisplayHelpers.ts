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

/** Coarse phase of a publish run, for UIs that show one label per stage. */
export type PublishRunPhase =
  | 'preparing'
  | 'uploading'
  | 'attesting'
  | 'retracting'
  | 'done'
  | 'failed'
  | 'stopped'

export type PublishRunDescription = {
  phase: PublishRunPhase
  /** The run is parked on an error and continues when it receives `retry` (`PublishManager.retryAttestations`). */
  awaitingRetry: boolean
  /** The publish machine reached a final state; it will not change again. */
  terminal: boolean
}

/**
 * Every top-level state of `publishMachine` (`services/publish/index.ts`). The machine has no
 * nested states, so its value is always one of these names. A test fails when a machine state
 * is missing here.
 */
export const PUBLISH_RUN_STATE_PHASES: Readonly<Record<string, PublishRunDescription>> = {
  authorizing: { phase: 'preparing', awaitingRetry: false, terminal: false },
  checking: { phase: 'preparing', awaitingRetry: false, terminal: false },
  preparingHtmlEmbedded: { phase: 'preparing', awaitingRetry: false, terminal: false },
  creatingArweaveDataItems: { phase: 'uploading', awaitingRetry: false, terminal: false },
  uploadingViaBundler: { phase: 'uploading', awaitingRetry: false, terminal: false },
  // Runs between the two uploads of an Html item with embedded media.
  rewritingHtmlEmbedded: { phase: 'uploading', awaitingRetry: false, terminal: false },
  creatingArweaveDataItemsPhase2: { phase: 'uploading', awaitingRetry: false, terminal: false },
  uploadingViaBundlerPhase2: { phase: 'uploading', awaitingRetry: false, terminal: false },
  creatingAttestations: { phase: 'attesting', awaitingRetry: false, terminal: false },
  attestationFailureRecoverable: { phase: 'attesting', awaitingRetry: true, terminal: false },
  creatingAttestationsDirectToEas: { phase: 'attesting', awaitingRetry: false, terminal: false },
  attestationFailureRecoverableDirectToEas: { phase: 'attesting', awaitingRetry: true, terminal: false },
  revokingRetractedProperties: { phase: 'retracting', awaitingRetry: false, terminal: false },
  retractionFailureRecoverable: { phase: 'retracting', awaitingRetry: true, terminal: false },
  // Reached only on `redundantPublishProcess`: another run already covers the item.
  stopping: { phase: 'stopped', awaitingRetry: false, terminal: true },
  [PublishMachineStates.SUCCESS]: { phase: 'done', awaitingRetry: false, terminal: true },
  [PublishMachineStates.FAILURE]: { phase: 'failed', awaitingRetry: false, terminal: true },
}

const NOT_STARTED: PublishRunDescription = { phase: 'preparing', awaitingRetry: false, terminal: false }

/**
 * The display phase of a publish machine value (`usePublishProcess().value`,
 * `useItemPublishStatus().publishValue`). `undefined`, or a value this version does not know,
 * reads as `preparing` and not terminal.
 */
export function describePublishRun(value: string | undefined): PublishRunDescription {
  const entry =
    value !== undefined && Object.hasOwn(PUBLISH_RUN_STATE_PHASES, value)
      ? PUBLISH_RUN_STATE_PHASES[value]
      : undefined
  return { ...(entry ?? NOT_STARTED) }
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
  if (record?.status === 'interrupted') return undefined
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
  if (record.status === 'interrupted') return undefined

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

/** The states a new publish replaces (ADR 0036): attestation failed and no attempt is open. */
const PARKED_STATES = new Set(['attestationFailureRecoverable', 'attestationFailureRecoverableDirectToEas'])

/** Whether `run` waits in a state a new publish of its seed replaces. */
export function isParkedRun(run: { getSnapshot: () => unknown } | undefined): boolean {
  return !!run && PARKED_STATES.has(String((run.getSnapshot() as { value?: unknown }).value))
}

/** The states a new publish replaces (ADR 0036): attestation failed and no attempt is open. */
const PARKED_STATES = new Set(['attestationFailureRecoverable', 'attestationFailureRecoverableDirectToEas'])

/** Whether a publish machine state value is one a new publish of its seed replaces. */
export function isParkedValue(value: unknown): boolean {
  return typeof value === 'string' && PARKED_STATES.has(value)
}

/** Whether `run` waits in a state a new publish of its seed replaces. */
export function isParkedRun(run: { getSnapshot: () => unknown } | undefined): boolean {
  return !!run && isParkedValue((run.getSnapshot() as { value?: unknown }).value)
}

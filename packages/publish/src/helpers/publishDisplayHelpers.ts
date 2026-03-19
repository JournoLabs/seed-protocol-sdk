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

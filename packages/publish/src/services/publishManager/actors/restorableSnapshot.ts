// Kept apart from restoreFromDb, which imports the publish machine (and through it the manager).

/** Minimal snapshot shape for restore; avoids excessive type recursion from SnapshotFrom<typeof publishMachine>.
 * Older rows may omit `context.attestationStrategy`; publish guards then fall back to `useDirectEas`. */
export interface PersistedSnapshot {
  status?: string
  value?: string | Record<string, unknown>
  context?: {
    item?: { seedLocalId?: string; modelName?: string; schemaId?: string }
    modelName?: string
    schemaId?: string
    bundlerUploadNotNeeded?: boolean
  }
}

function getStateValue(parsed: PersistedSnapshot): string {
  const v = parsed.value
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    return (keys[0] ?? '') as string
  }
  return ''
}

/** Upload states that need the signed data items, which aren't saved with the publish. */
const BUNDLER_UPLOAD_STATES = new Set(['uploadingViaBundler', 'uploadingViaBundlerPhase2'])

/**
 * States of the L1 upload path (an Arweave transaction reimbursed through the upload API), which
 * was removed. The machine no longer has them, so a publish saved in one can't resume.
 */
const REMOVED_L1_STATES = new Set([
  'creatingArweaveTransactions',
  'sendingReimbursementRequest',
  'pollingForConfirmation',
  'uploadingData',
  'creatingArweaveTransactionsPhase2',
  'sendingReimbursementRequestPhase2',
  'pollingForConfirmationPhase2',
  'uploadingDataPhase2',
])

export function isRestorableSnapshot(parsed: PersistedSnapshot): boolean {
  const stateValue = getStateValue(parsed)
  if (REMOVED_L1_STATES.has(stateValue)) return false
  // Resuming here would have nothing to upload, unless there was nothing to upload anyway.
  if (BUNDLER_UPLOAD_STATES.has(stateValue as string) && parsed.context?.bundlerUploadNotNeeded !== true) {
    return false
  }
  return true
}


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
    reimbursementTransactionId?: string
    requestResponse?: unknown
    arweaveTransactions?: unknown[]
    publishUploads?: unknown[]
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

export function isRestorableSnapshot(parsed: PersistedSnapshot): boolean {
  const stateValue = getStateValue(parsed)
  // Resuming here would have nothing to upload, unless there was nothing to upload anyway.
  if (BUNDLER_UPLOAD_STATES.has(stateValue as string) && parsed.context?.bundlerUploadNotNeeded !== true) {
    return false
  }
  if (stateValue === 'pollingForConfirmation' || stateValue === 'pollingForConfirmationPhase2') {
    if (!parsed.context?.reimbursementTransactionId || !parsed.context?.requestResponse) return false
  }
  if (stateValue === 'uploadingData' || stateValue === 'uploadingDataPhase2') {
    const txs = parsed.context?.arweaveTransactions
    const uploads = parsed.context?.publishUploads
    if (!Array.isArray(txs) || txs.length === 0 || !Array.isArray(uploads)) return false
  }
  return true
}


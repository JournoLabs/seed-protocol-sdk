/**
 * Extracts Arweave transaction IDs from a publish process record's persisted snapshot.
 * Returns an empty array on parse error or when no transactions exist.
 */
export function getArweaveTransactionIds(record: { persistedSnapshot: string }): string[] {
  try {
    const parsed = JSON.parse(record.persistedSnapshot) as {
      context?: { arweaveTransactions?: Array<{ transaction?: { id?: string } }> }
    }
    const txs = parsed.context?.arweaveTransactions ?? []
    return txs
      .map((at) => (at.transaction as { id?: string })?.id)
      .filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/**
 * Extracts the EAS attestation payload from a publish process record's persisted snapshot.
 * Returns undefined on parse error or when no payload was persisted.
 */
export function getEasPayload(record: { persistedSnapshot: string }): unknown {
  try {
    const parsed = JSON.parse(record.persistedSnapshot) as {
      context?: { easPayload?: unknown }
    }
    return parsed.context?.easPayload ?? undefined
  } catch {
    return undefined
  }
}

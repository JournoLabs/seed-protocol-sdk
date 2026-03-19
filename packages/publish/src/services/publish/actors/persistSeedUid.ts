import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors:persistSeedUid')

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

/** Timeout for persistSeedUid. Attestations are already on-chain; DB write is best-effort. */
const PERSIST_SEED_UID_TIMEOUT_MS = 15_000

export type RequestWithSeedUid = { seedUid?: string }

/**
 * Assigns the first request's non-zero seedUid to the item so the SDK's
 * in-memory context is updated after a successful publish.
 */
export function persistSeedUidFromPublishResult(
  item: { seedUid?: string },
  normalizedRequests: RequestWithSeedUid[],
): void {
  const firstRequestSeedUid = normalizedRequests[0]?.seedUid
  if (firstRequestSeedUid && firstRequestSeedUid !== ZERO_BYTES32) {
    ;(item as { seedUid?: string }).seedUid = firstRequestSeedUid
  }
}

/**
 * Wraps item.persistSeedUid with timeout and error handling. Attestations are already
 * on-chain; if this fails or times out, we log and continue. Prevents the publish
 * flow from hanging when DB write is slow or fails.
 */
export async function persistSeedUidSafely(
  item: { persistSeedUid?: (publisher?: string) => Promise<void> },
  address: string,
): Promise<void> {
  const persist = item.persistSeedUid
  if (typeof persist !== 'function') return

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('persistSeedUid timed out')), PERSIST_SEED_UID_TIMEOUT_MS),
  )

  try {
    await Promise.race([persist.call(item, address), timeout])
  } catch (err) {
    logger('persistSeedUid failed (attestations already on-chain):', err)
    // Don't throw - attestations are confirmed; DB write is best-effort
  }
}

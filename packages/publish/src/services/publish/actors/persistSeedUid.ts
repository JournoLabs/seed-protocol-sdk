import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors:persistSeedUid')

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

/** Timeout for persistSeedUid. Attestations are already on-chain; DB write is best-effort. */
const PERSIST_SEED_UID_TIMEOUT_MS = 15_000

export type RequestWithSeedUid = { seedUid?: string; localId?: string }

/**
 * Assigns the published item's seedUid from the matching request (by item.seedLocalId).
 * Multi-publish payloads are ordered so the first request is not always the root item (e.g. Image before Post).
 */
export function persistSeedUidFromPublishResult(
  item: { seedUid?: string; seedLocalId?: string },
  normalizedRequests: RequestWithSeedUid[],
): void {
  const seedLocalId = item.seedLocalId
  const match = seedLocalId
    ? normalizedRequests.find((r) => r?.localId === seedLocalId)
    : undefined
  const uid =
    match?.seedUid && match.seedUid !== ZERO_BYTES32
      ? match.seedUid
      : normalizedRequests[0]?.seedUid
  if (uid && uid !== ZERO_BYTES32) {
    item.seedUid = uid
  }
}

/**
 * Wraps item.persistSeedUid with timeout and error handling. Attestations are already
 * on-chain; if this fails or times out, we log and continue. Prevents the publish
 * flow from hanging when DB write is slow or fails.
 */
export async function persistSeedUidSafely(
  item: {
    persistSeedUid?: (publisher?: string, attestationCreatedAtMs?: number) => Promise<void>
  },
  address: string,
  attestationCreatedAtMs?: number,
): Promise<void> {
  const persist = item.persistSeedUid
  if (typeof persist !== 'function') return

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('persistSeedUid timed out')), PERSIST_SEED_UID_TIMEOUT_MS),
  )

  try {
    await Promise.race([persist.call(item, address, attestationCreatedAtMs), timeout])
  } catch (err) {
    logger('persistSeedUid failed (attestations already on-chain):', err)
    // Don't throw - attestations are confirmed; DB write is best-effort
  }
}

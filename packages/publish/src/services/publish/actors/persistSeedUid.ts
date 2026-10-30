import debug from 'debug'

const logger = debug('seedProtocol:services:publish:actors:persistSeedUid')

const ZERO_BYTES32 = '0x' + '0'.repeat(64)

/** Timeout for persistSeedUid. The seed row already holds the uid; see persistSeedUidSafely. */
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
  // The first request is only a fallback when no request is the item's: in a batch it can be a
  // related item (e.g. an Image published before its Post), whose seed uid is not the item's.
  const uid = match ? match.seedUid : normalizedRequests[0]?.seedUid
  if (uid && uid !== ZERO_BYTES32) {
    item.seedUid = uid
  }
}

/**
 * Brings the loaded item up to date (item.persistSeedUid) after recordPublishRequests has written
 * its seed uid, with a timeout. The row is what later publishes read, so a failure here is logged
 * and the publish continues. Never the only record of a seed uid: this swallows failures.
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

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('persistSeedUid timed out')), PERSIST_SEED_UID_TIMEOUT_MS)
  })

  try {
    await Promise.race([persist.call(item, address, attestationCreatedAtMs), timeout])
  } catch (err) {
    logger('persistSeedUid failed (the seed row already holds the uid):', err)
  } finally {
    clearTimeout(timer)
  }
}

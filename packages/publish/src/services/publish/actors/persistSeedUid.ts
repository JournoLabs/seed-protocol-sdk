const ZERO_BYTES32 = '0x' + '0'.repeat(64)

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

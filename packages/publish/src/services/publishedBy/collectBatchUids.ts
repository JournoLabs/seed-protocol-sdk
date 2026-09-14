import { isValidEasAttestationUid, normalizeBytes32Hex } from '@seedprotocol/eas'
import type { PublishedBatchResult } from './index'

const ZERO =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const

function pushUid(out: string[], uid: string | undefined | null) {
  if (!uid) return
  const n = normalizeBytes32Hex(uid)
  if (!isValidEasAttestationUid(n)) return
  out.push(n)
}

/**
 * Build a {@link PublishedBatchResult} from seed/version UIDs and any additional attestation UIDs
 * (property attestations, related seeds, etc.) collected from publish receipts.
 */
export function collectPublishedBatch(params: {
  seedUid: string
  versionUid?: string | null
  extraUids?: readonly (string | undefined | null)[]
}): PublishedBatchResult | null {
  const seedUid = normalizeBytes32Hex(params.seedUid) as `0x${string}`
  if (!isValidEasAttestationUid(seedUid)) return null

  const attestationUids: string[] = []
  pushUid(attestationUids, seedUid)
  if (params.versionUid) pushUid(attestationUids, params.versionUid)
  for (const u of params.extraUids ?? []) {
    pushUid(attestationUids, u)
  }

  // Dedupe preserving order
  const seen = new Set<string>()
  const unique: `0x${string}`[] = []
  for (const u of attestationUids) {
    const key = u.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(u as `0x${string}`)
  }

  const versionRaw = params.versionUid ? normalizeBytes32Hex(params.versionUid) : undefined
  const versionUid =
    versionRaw && isValidEasAttestationUid(versionRaw)
      ? (versionRaw as `0x${string}`)
      : undefined

  return {
    seedUid,
    versionUid,
    attestationUids: unique,
  }
}

/**
 * Flatten CreatedAttestation / Attested pairs into UID strings (skips placeholders).
 */
export function uidsFromAttestationPairs(
  pairs: readonly { attestationUid?: string; uid?: string }[],
): string[] {
  const out: string[] = []
  for (const p of pairs) {
    pushUid(out, p.attestationUid ?? p.uid)
  }
  return out
}

export { ZERO as ZERO_BYTES32_PUBLISHED_BY }

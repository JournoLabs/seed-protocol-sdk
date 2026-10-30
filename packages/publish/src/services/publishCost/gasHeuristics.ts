/**
 * Rough Optimism L2 gas for Seed `multiPublish` / EAS attestations.
 * These are heuristics for a USD quote, not `eth_estimateGas`.
 */
export const PUBLISH_GAS_HEURISTICS = {
  BASE: 80_000n,
  NEW_SEED: 120_000n,
  NEW_VERSION: 80_000n,
  ATTESTATION: 55_000n,
  /** Revoking one attestation of a retracted property (ADR 0021): EAS sets its revocation time. */
  REVOCATION: 35_000n,
} as const

export function heuristicPublishGas(work: {
  newSeedCount: number
  newVersionCount: number
  attestationCount: number
  revocationCount?: number
}): bigint {
  return (
    PUBLISH_GAS_HEURISTICS.BASE +
    PUBLISH_GAS_HEURISTICS.NEW_SEED * BigInt(work.newSeedCount) +
    PUBLISH_GAS_HEURISTICS.NEW_VERSION * BigInt(work.newVersionCount) +
    PUBLISH_GAS_HEURISTICS.ATTESTATION * BigInt(work.attestationCount) +
    PUBLISH_GAS_HEURISTICS.REVOCATION * BigInt(work.revocationCount ?? 0)
  )
}

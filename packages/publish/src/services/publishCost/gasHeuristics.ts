/**
 * Rough Optimism L2 gas for Seed `multiPublish` / EAS attestations.
 * These are heuristics for a USD quote, not `eth_estimateGas`.
 */
export const PUBLISH_GAS_HEURISTICS = {
  BASE: 80_000n,
  NEW_SEED: 120_000n,
  NEW_VERSION: 80_000n,
  ATTESTATION: 55_000n,
} as const

export function heuristicPublishGas(work: {
  newSeedCount: number
  newVersionCount: number
  attestationCount: number
}): bigint {
  return (
    PUBLISH_GAS_HEURISTICS.BASE +
    PUBLISH_GAS_HEURISTICS.NEW_SEED * BigInt(work.newSeedCount) +
    PUBLISH_GAS_HEURISTICS.NEW_VERSION * BigInt(work.newVersionCount) +
    PUBLISH_GAS_HEURISTICS.ATTESTATION * BigInt(work.attestationCount)
  )
}

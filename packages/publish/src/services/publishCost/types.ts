import type { PublishMode } from '@seedprotocol/sdk'

export type { PublishMode }

export type PublishWorkSummary = {
  publishMode: PublishMode
  seedCount: number
  newSeedCount: number
  newVersionCount: number
  attestationCount: number
  uploadCount: number
  uploadBytes: number
}

export type PublishCostEstimate = {
  totalUsd: number
  evm: {
    eth: string
    usd: number
    gas: bigint
    userPays: boolean
  }
  arweave: {
    ar: string
    usd: number
    bytes: number
    uploadCount: number
    path: 'l1' | 'bundler'
    userPays: boolean
  }
  prices: {
    ethUsd: number
    arUsd: number
    fetchedAt: number
  }
  work: PublishWorkSummary
  estimatedAt: number
}

export type EstimatePublishCostOptions = {
  publishMode?: PublishMode
  /** Skip summarize + network; used by tests and the watcher reprice path. */
  work?: PublishWorkSummary
  rates?: {
    ethUsd: number
    arUsd: number
    fetchedAt: number
    gasPriceWei: bigint
    winstonPerByte: number
  }
}

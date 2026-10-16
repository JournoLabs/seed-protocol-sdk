import type { PublishMode, UnpublishedRelatedItem } from '@seedprotocol/sdk'

export type { PublishMode }

export type PublishWorkSummary = {
  publishMode: PublishMode
  seedCount: number
  newSeedCount: number
  newVersionCount: number
  attestationCount: number
  uploadCount: number
  uploadBytes: number
  /** References to unpublished items; when non-empty the publish fails before sending anything. */
  unpublishedRelatedItems?: UnpublishedRelatedItem[]
}

export type PublishCostEstimate = {
  /** Cost of the publish whoever pays it; see `evm.userPays` / `arweave.userPays`. */
  totalUsd: number
  evm: {
    eth: string
    usd: number
    gas: bigint
    /** Whether the user's wallet pays this gas, or a sponsor (paymaster / Thirdweb) does. */
    userPays: boolean
  }
  arweave: {
    ar: string
    usd: number
    bytes: number
    uploadCount: number
    path: 'l1' | 'bundler'
    /**
     * Whether the user pays for storage (`payment.storage`). With the default `'operator'` the
     * upload API funds it: on the bundler path directly, on the L1 path by reimbursing the user's
     * Arweave key before the upload (the deferred-Html second pass is not reimbursed).
     */
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

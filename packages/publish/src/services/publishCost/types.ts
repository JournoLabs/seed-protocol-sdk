import type { PublishMode, UnpublishedRelatedItem } from '@seedprotocol/sdk'

export type { PublishMode }

export type PublishWorkSummary = {
  publishMode: PublishMode
  seedCount: number
  newSeedCount: number
  newVersionCount: number
  attestationCount: number
  /**
   * Attestations the publish revokes for retracted properties (ADR 0021). Optional for a summary
   * built by hand; the SDK's summarizePublishWork always sets it.
   */
  revocationCount?: number
  uploadCount: number
  uploadBytes: number
  /** Size of each upload. Without it, uploads are taken as equal parts of uploadBytes. */
  uploadSizes?: number[]
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
    /** The publish chain is a testnet: its ETH has no value, so `usd` is 0. */
    testnet: boolean
  }
  arweave: {
    ar: string
    usd: number
    /** Bytes uploaded. */
    bytes: number
    /**
     * Bytes paid for, measured on the signed data items (each upload plus its ANS-104 header and
     * tags): the bundle is one transaction, charged for at least 256 KiB; with Turbo, data items
     * of `freeBytes` or less are free.
     */
    chargedBytes: number
    uploadCount: number
    /** Where uploads go (`payment.storage`): the upload API, or Turbo for user-paid storage. */
    uploadTo: 'upload-api' | 'turbo'
    /** Largest data item Turbo stores for free, from Turbo's `/v1/info`; 0 for the upload API. */
    freeBytes: number
    /** Always `'bundler'`: uploads are signed data items. */
    path: 'bundler'
    /**
     * Whether the user pays for storage (`payment.storage`). With the default `'operator'` the
     * upload API's bundler routes pay for the data items.
     */
    userPays: boolean
  }
  prices: {
    ethUsd: number
    arUsd: number
    fetchedAt: number
  }
  /** Upload size, time and memory, and whether the publish limits refuse it or need a confirm. */
  upload: import('./uploadEstimate').UploadEstimate
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

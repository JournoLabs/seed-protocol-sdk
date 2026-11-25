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
  /**
   * Arweave storage cost. Absent when the configured blob store doesn't send uploads through the
   * upload API or Turbo (`BlobStore.usesUploadApi` is false); see {@link PublishCostEstimate.storage}.
   */
  arweave?: {
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
  /**
   * Where uploads go and whether `totalUsd` includes their cost. `priced: false` means the blob
   * store is not Arweave-backed: storage is not in `totalUsd`, which is gas only.
   */
  storage: {
    /** The blob store's `id`. */
    store: string
    priced: boolean
  }
  prices: {
    ethUsd: number
    arUsd: number
    fetchedAt: number
  }
  /** Upload size, time and memory, and whether the publish limits refuse it or need a confirm. */
  upload: import('./uploadEstimate').UploadEstimate
  work: PublishWorkSummary
  /**
   * How many transactions the publish is expected to go out in when it goes through the publish
   * contract (ADR 0036): the same count `checking` reports as `expectedPublishTransactions`, from
   * the local gas estimate, so a lower bound. Each costs `evm.gas` of its own. Absent on the
   * direct EAS route, when `options.work` was passed, and when the payload can't be built or one
   * item is too large for a transaction (the publish refuses that).
   */
  expectedPublishTransactions?: number
  estimatedAt: number
}

export type EstimatePublishCostOptions = {
  publishMode?: PublishMode
  /**
   * How references back to items this publish creates are counted (`summarizePublishWork`'s
   * option). Defaults to the route the publish takes: `'defer'` when it attests directly to EAS
   * (`useDirectEas`, or a registered wallet whose publisher is an EOA), else `'link'`, the publish
   * contract's rule.
   */
  backReferences?: 'link' | 'defer'
  /** Skip summarize + network; used by tests and the watcher reprice path. */
  work?: PublishWorkSummary
  /** Tags each upload carries beyond Content-SHA-256 and Content-Type. Default `arweaveUploadTags`. */
  uploadTags?: import('@seedprotocol/sdk').TransactionTag[]
  /**
   * How many of `work.uploadSizes`, in order, go in each bundle, when the uploads are sent in more
   * than one. Each bundle is charged Arweave's 256 KiB minimum. Default one bundle.
   */
  uploadBatches?: number[]
  /**
   * Price storage on Arweave whatever `blobStore` says, for operations that always upload there
   * (archive anchors).
   */
  arweaveStorage?: boolean
  rates?: {
    ethUsd: number
    arUsd: number
    fetchedAt: number
    gasPriceWei: bigint
    winstonPerByte: number
  }
}

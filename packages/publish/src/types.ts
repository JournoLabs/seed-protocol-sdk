import type { IItem, TransactionTag } from '@seedprotocol/sdk'

/** Aligns with `@seedprotocol/sdk` `PublishMode`. */
export type PublishMode = 'patch' | 'new_version'

/** Aligns with `@seedprotocol/sdk` `HtmlEmbeddedDataUriPolicy`. */
export type HtmlEmbeddedDataUriPolicy = import('@seedprotocol/sdk').HtmlEmbeddedDataUriPolicy
import type { SeedSigner, PublishWallet } from './helpers/seedSigner'
import type { ethers } from 'ethers'

/** Upload data for a single publish property (storage seed). */
export type PublishUpload = {
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
  transactionToSign: unknown
}

/** Arweave transaction info used in publish/upload flow. */
export interface ArweaveTransactionInfo {
  transaction: { id: string; data?: unknown; chunks?: unknown; [key: string]: unknown }
  versionId?: string
  modelName?: string
}


/** Context for the publish state machine. */
export interface PublishMachineContext {
  item: IItem<any>
  address: string
  /** Plain model name so it survives XState snapshot persistence (Item.modelName is a getter). */
  modelName?: string
  schemaId?: string
  /**
   * Wallet used to sign DataItems and send on-chain txs (setEas / multiPublish).
   * Prefer {@link PublishWallet}; legacy `account` alias accepted by createPublish coercion.
   */
  wallet?: PublishWallet
  /** @deprecated Prefer `wallet`. Kept for snapshot restore during transition. */
  account?: PublishWallet | SeedSigner
  seedId?: string
  existingSeedUid?: string
  arweaveTransactions?: ArweaveTransactionInfo[]
  publishUploads?: unknown[]
  completionPercentage?: number
  /** Set when machine transitions to failure (from onError or uploadError). */
  error?: unknown
  /** Which state failed (e.g. creatingArweaveDataItems, uploadingViaBundler). */
  errorStep?: string
  /** Raw EAS attestation payload from getPublishPayload, stored for later retrieval. */
  easPayload?: unknown
  /**
   * Ephemeral: full signed DataItem bytes for `uploadingViaBundler` only (dataItemSigner path).
   * Cleared from context after a successful batch upload; do not rely on this after that state.
   * Not included in DB snapshots.
   */
  signedDataItems?: { id: string; raw: Uint8Array }[]
  /**
   * uploadViaBundler has nothing to send: the app's `signDataItems` uploaded the data items itself,
   * or there were none. Saved with the publish (unlike signedDataItems), so a restored publish can
   * tell this from items it lost on reload.
   */
  bundlerUploadNotNeeded?: boolean
  /**
   * Per-publish: sign DataItems (from createPublish options).
   * Each upload has `tags` (content + arweaveUploadTags); use when building DataItems.
   */
  signDataItems?: (
    uploads: import('./services/publish/helpers/getPublishUploadData').PublishUploadData[]
  ) => Promise<import('./config').ArweaveDataItemInfoResult[]>
  /** Per-publish: signer for DataItems (from createPublish options). */
  dataItemSigner?: ethers.Wallet | SeedSigner | PublishWallet
  /**
   * Resolved Arweave tags for this run: initPublish defaults then createPublish extras.
   * Appended after Content-SHA-256 / Content-Type on each upload.
   */
  arweaveUploadTags?: TransactionTag[]
  /**
   * Set when leaving `checking`: whether attestations use Seed `multiPublish` on the publisher/managed
   * contract or direct EAS (`createAttestationsDirectToEas`). Omitted on restored snapshots: guards
   * fall back to `getPublishConfig().useDirectEas`.
   */
  attestationStrategy?: 'multiPublish' | 'directEas'
  /** `patch` (default): attest only pending properties on current Version. `new_version`: new Version + full snapshot. */
  publishMode?: PublishMode
  /**
   * How to handle `data:image/*` inside Html storage at publish time.
   * Per-property `htmlEmbeddedDataUriPolicy` on the schema overrides this. Default: `materialize`.
   */
  htmlEmbeddedDataUriPolicy?: HtmlEmbeddedDataUriPolicy
  /** How Arweave links are written into Html (ADR 0025). Default: `gateway`. */
  htmlArweaveRefs?: import('@seedprotocol/sdk').HtmlArweaveRefs
  /** Set during publish after embedded-image prep: Html seeds uploaded in a second pass. */
  htmlEmbeddedDeferredHtmlSeedLocalIds?: string[]
  htmlEmbeddedPhase1PublishUploads?: PublishUpload[]
  htmlEmbeddedPhase1ArweaveTransactions?: ArweaveTransactionInfo[]
  /**
   * Unique id for this publish actor run. Used to ignore async stale DB writes that would
   * INSERT a duplicate row after the same run already completed.
   */
  publishRunId?: string
  /**
   * Optional callback when publish succeeds with a resolved attestation batch (tool PublishedBy flow).
   */
  onPublished?: import('./services/publishedBy').OnPublishedCallback
  /** Approves the publish before anything is spent (per publish, else `PublishConfig.authorizePublish`). */
  authorizePublish?: import('./authorization').AuthorizePublish
  /** What `authorizePublish` returned; its token goes to the upload API. Persisted for resume. */
  publishAuthorization?: import('./authorization').PublishAuthorization
  /** Resolved batch from attest actors; set on transition to success. */
  publishedBatch?: import('./services/publishedBy').PublishedBatchResult | null
  [key: string]: unknown
}
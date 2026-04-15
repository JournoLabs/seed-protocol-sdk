import type { IItem, TransactionTag } from '@seedprotocol/sdk'

/** Aligns with `@seedprotocol/sdk` `PublishMode`. */
export type PublishMode = 'patch' | 'new_version'

/** Aligns with `@seedprotocol/sdk` `HtmlEmbeddedDataUriPolicy`. */
export type HtmlEmbeddedDataUriPolicy = import('@seedprotocol/sdk').HtmlEmbeddedDataUriPolicy
import type { Account } from 'thirdweb/wallets'
import type { ethers } from 'ethers'

export type ReimbursementResponse = { transactionId: string }

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
  /** Smart wallet (in-app) account used to sign/send setEas and multiPublish; passed from UI when starting publish. */
  account?: Account
  seedId?: string
  existingSeedUid?: string
  arweaveTransactions?: ArweaveTransactionInfo[]
  publishUploads?: unknown[]
  reimbursementTransactionId?: string
  reimbursementConfirmed?: boolean
  transactionKeys?: string
  requestResponse?: unknown
  completionPercentage?: number
  /** Serialized uploader state for resume (from uploader.toJSON()). */
  uploaderState?: { chunkIndex: number; transaction: unknown; txPosted: boolean; [key: string]: unknown }
  /** Index of current transaction being uploaded when resuming. */
  currentTransactionIndex?: number
  /** Set when machine transitions to failure (from onError or uploadError). */
  error?: unknown
  /** Which state failed (e.g. creatingArweaveTransactions, sendingReimbursementRequest). */
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
   * Per-publish: sign DataItems when useArweaveBundler (from createPublish options).
   * Each upload has `tags` (content + arweaveUploadTags); use when building DataItems.
   */
  signDataItems?: (
    uploads: import('./services/publish/helpers/getPublishUploadData').PublishUploadData[]
  ) => Promise<import('./config').ArweaveDataItemInfoResult[]>
  /** Per-publish: signer for DataItems when useArweaveBundler (from createPublish options). */
  dataItemSigner?: ethers.Wallet | Account
  /** Per-publish: sign Arweave transactions when NOT useArweaveBundler (from createPublish options). */
  signArweaveTransactions?: (
    uploads: import('./config').SerializedPublishUpload[]
  ) => Promise<import('./config').ArweaveTransactionInfoResult[]>
  /** Per-publish: JWK for in-process signing when NOT useArweaveBundler (from createPublish options). */
  arweaveJwk?: { kty: string; n: string; e: string; d?: string; [key: string]: unknown }
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
  /** Set during publish after embedded-image prep (non-bundler two-phase L1). */
  htmlEmbeddedDeferredHtmlSeedLocalIds?: string[]
  htmlEmbeddedPhase1PublishUploads?: PublishUpload[]
  htmlEmbeddedPhase1ArweaveTransactions?: ArweaveTransactionInfo[]
  /**
   * Unique id for this publish actor run. Used to ignore async stale DB writes that would
   * INSERT a duplicate row after the same run already completed.
   */
  publishRunId?: string
  [key: string]: unknown
}
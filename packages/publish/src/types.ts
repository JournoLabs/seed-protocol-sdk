import type { Item } from '@seedprotocol/sdk'
import type { Account } from 'thirdweb/wallets'

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
  item: Item
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
  /** Set when machine transitions to failure (from onError or uploadError). */
  error?: unknown
  /** Which state failed (e.g. creatingArweaveTransactions, sendingReimbursementRequest). */
  errorStep?: string
  [key: string]: unknown
}
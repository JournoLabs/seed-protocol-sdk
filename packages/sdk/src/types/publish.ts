import { ArweaveTransaction } from "@/node"
import type { TransactionTag } from '@seedprotocol/arweave'

export type PublishUpload = {
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
  transactionToSign: ArweaveTransaction
}

/** One upload's raw content and tags, before any Arweave transaction or DataItem is made from it. */
export type PublishUploadData = {
  /**
   * The upload's content. For a file this is backed by disk, so reading it loads the bytes then,
   * and a file changed since the publish opened it can give different bytes without an error. Load
   * it with `readPublishUploadBytes`, which checks them against `contentHash`.
   */
  blob: Blob
  /** Hex SHA-256 of `blob` (the Content-SHA-256 tag value). */
  contentHash?: string
  contentType?: string
  /** Full tag list for the transaction / DataItem: content tags, then configured arweaveUploadTags. */
  tags: TransactionTag[]
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
}

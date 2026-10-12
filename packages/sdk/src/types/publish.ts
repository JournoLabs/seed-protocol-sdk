import { ArweaveTransaction } from "@/node"
import type { TransactionTag } from '@/types/arweave'

export type PublishUpload = {
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
  transactionToSign: ArweaveTransaction
}

/** One upload's raw bytes and tags, before any Arweave transaction or DataItem is made from it. */
export type PublishUploadData = {
  data: Uint8Array
  /** Hex SHA-256 of `data` (the Content-SHA-256 tag value). */
  contentHash?: string
  contentType?: string
  /** Full tag list for the transaction / DataItem: content tags, then configured arweaveUploadTags. */
  tags: TransactionTag[]
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
}

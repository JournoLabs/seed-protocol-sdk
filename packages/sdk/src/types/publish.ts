import { ArweaveTransaction } from "@/node"

export type PublishUpload = {
  itemPropertyName: string
  itemPropertyLocalId: string
  seedLocalId: string
  versionLocalId: string
  transactionToSign: ArweaveTransaction
}
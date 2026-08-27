import type { GraphQLClient } from 'graphql-request'
import type {
  TransactionStatus,
  TransactionTag,
  GetDataOptions,
  DownloadFilesParams,
  DownloadResult,
  CreateTransactionOptions,
} from '../types/arweave.js'

export interface IArweaveClient {
  getArweaveClient(): GraphQLClient
  getTransactionStatus(transactionId: string): Promise<TransactionStatus>
  getTransactionData(
    transactionId: string,
    options?: GetDataOptions,
  ): Promise<Uint8Array | string>
  getTransactionTags(transactionId: string): Promise<TransactionTag[]>
  createTransaction(
    data: string | Uint8Array,
    options?: CreateTransactionOptions,
  ): Promise<any>
  downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]>
}

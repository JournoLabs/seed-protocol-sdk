/**
 * MockArweaveClient for testing
 *
 * This mock implementation allows tests to control Arweave behavior without
 * making real network requests. Use this by configuring it on the facade:
 *
 * @example
 * ```typescript
 * import { MockArweaveClient } from '../test-utils/MockArweaveClient'
 * import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
 *
 * beforeEach(() => {
 *   BaseArweaveClient.configure(new MockArweaveClient())
 *   MockArweaveClient.reset()
 * })
 *
 * it('should download a file', async () => {
 *   MockArweaveClient.addMockTransaction('tx123', new TextEncoder().encode('test content'))
 *   const data = await BaseArweaveClient.getTransactionData('tx123')
 *   expect(data).toEqual(new TextEncoder().encode('test content'))
 * })
 * ```
 */

import type { IArweaveClient } from '@seedprotocol/arweave'
import { GraphQLClient } from 'graphql-request'
import type {
  TransactionStatus,
  TransactionTag,
  GetDataOptions,
  DownloadFilesParams,
  DownloadResult,
  CreateTransactionOptions,
} from '@/types/arweave'

type MockTransaction = {
  data: Uint8Array
  tags: TransactionTag[]
  status: number
  confirmed: TransactionStatus['confirmed']
}

type MockCreatedTransaction = {
  id: string
  data: Uint8Array
  tags: TransactionTag[]
}

/** Shared mock state so static helpers and configured instances stay in sync for tests. */
const shared = {
  mockTransactions: new Map<string, MockTransaction>(),
  createdTransactions: [] as MockCreatedTransaction[],
  transactionIdCounter: 0,
  mockHost: 'arweave.net',
}

export class MockArweaveClient implements IArweaveClient {
  /**
   * Reset all mock data
   */
  static reset(): void {
    shared.mockTransactions.clear()
    shared.createdTransactions = []
    shared.transactionIdCounter = 0
    shared.mockHost = 'arweave.net'
  }

  /**
   * Set a custom mock host
   */
  static setMockHost(host: string): void {
    shared.mockHost = host
  }

  /**
   * Add a mock transaction for testing
   */
  static addMockTransaction(
    id: string,
    data: Uint8Array,
    options?: {
      tags?: TransactionTag[]
      status?: number
      confirmed?: TransactionStatus['confirmed']
    }
  ): void {
    const hasExplicitConfirmed = options && 'confirmed' in options
    
    shared.mockTransactions.set(id, {
      data,
      tags: options?.tags || [],
      status: options?.status ?? 200,
      confirmed: hasExplicitConfirmed 
        ? options!.confirmed 
        : {
            block_height: 1000000,
            block_indep_hash: 'mock-block-hash',
            number_of_confirmations: 100,
          },
    })
  }

  /**
   * Remove a mock transaction
   */
  static removeMockTransaction(id: string): void {
    shared.mockTransactions.delete(id)
  }

  /**
   * Get all created transactions (useful for verifying createTransaction was called)
   */
  static getCreatedTransactions(): MockCreatedTransaction[] {
    return [...shared.createdTransactions]
  }

  /**
   * Get the last created transaction
   */
  static getLastCreatedTransaction(): MockCreatedTransaction | undefined {
    return shared.createdTransactions[shared.createdTransactions.length - 1]
  }

  reset(): void {
    MockArweaveClient.reset()
  }

  setMockHost(host: string): void {
    MockArweaveClient.setMockHost(host)
  }

  addMockTransaction(
    id: string,
    data: Uint8Array,
    options?: {
      tags?: TransactionTag[]
      status?: number
      confirmed?: TransactionStatus['confirmed']
    }
  ): void {
    MockArweaveClient.addMockTransaction(id, data, options)
  }

  getArweaveClient(): GraphQLClient {
    return new GraphQLClient(`https://${shared.mockHost}/graphql`)
  }

  async getTransactionStatus(transactionId: string): Promise<TransactionStatus> {
    const tx = shared.mockTransactions.get(transactionId)
    
    if (!tx) {
      return {
        status: 404,
        confirmed: null,
      }
    }

    return {
      status: tx.status,
      confirmed: tx.confirmed,
    }
  }

  async getTransactionData(
    transactionId: string,
    options?: GetDataOptions
  ): Promise<Uint8Array | string> {
    const tx = shared.mockTransactions.get(transactionId)
    
    if (!tx) {
      throw new Error(`Transaction ${transactionId} not found`)
    }

    if (options?.string) {
      return new TextDecoder().decode(tx.data)
    }

    return tx.data
  }

  async getTransactionTags(transactionId: string): Promise<TransactionTag[]> {
    const tx = shared.mockTransactions.get(transactionId)
    
    if (!tx) {
      return []
    }

    return tx.tags
  }

  async createTransaction(
    data: string | Uint8Array,
    options?: CreateTransactionOptions
  ): Promise<any> {
    const id = `mock-tx-${++shared.transactionIdCounter}`
    
    const dataArray = typeof data === 'string' 
      ? new TextEncoder().encode(data)
      : data

    const mockTx: MockCreatedTransaction = {
      id,
      data: dataArray,
      tags: options?.tags || [],
    }

    shared.createdTransactions.push(mockTx)

    return {
      id,
      data: dataArray,
      tags: mockTx.tags.map(tag => ({ name: tag.name, value: tag.value })),
      addTag: (name: string, value: string) => {
        mockTx.tags.push({ name, value })
      },
    }
  }

  async downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]> {
    const { transactionIds, excludedTransactions } = params
    const results: DownloadResult[] = []

    for (const transactionId of transactionIds) {
      if (excludedTransactions?.has(transactionId)) {
        continue
      }

      const tx = shared.mockTransactions.get(transactionId)

      if (!tx) {
        results.push({
          transactionId,
          success: false,
          error: `Transaction ${transactionId} not found`,
        })
        continue
      }

      if (tx.status !== 200) {
        results.push({
          transactionId,
          success: false,
          error: `HTTP ${tx.status}`,
        })
        continue
      }

      results.push({
        transactionId,
        success: true,
        data: tx.data,
        contentType: 'application/octet-stream',
      })
    }

    return results
  }
}

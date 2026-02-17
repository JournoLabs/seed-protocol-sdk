/**
 * MockArweaveClient for testing
 * 
 * This mock implementation allows tests to control Arweave behavior without
 * making real network requests. Use this by setting it as the platform class:
 * 
 * @example
 * ```typescript
 * import { MockArweaveClient } from '../test-utils/MockArweaveClient'
 * import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
 * 
 * beforeEach(() => {
 *   BaseArweaveClient.setPlatformClass(MockArweaveClient)
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

import { BaseArweaveClient } from '@/helpers/ArweaveClient/BaseArweaveClient'
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

class MockArweaveClient extends BaseArweaveClient {
  // Storage for mock transactions
  private static mockTransactions = new Map<string, MockTransaction>()
  
  // Storage for created transactions (for testing createTransaction)
  private static createdTransactions: MockCreatedTransaction[] = []
  
  // Counter for generating mock transaction IDs
  private static transactionIdCounter = 0
  
  // Custom host for testing
  private static mockHost = 'arweave.net'

  /**
   * Reset all mock data
   */
  static reset(): void {
    this.mockTransactions.clear()
    this.createdTransactions = []
    this.transactionIdCounter = 0
    this.mockHost = 'arweave.net'
  }

  /**
   * Set a custom mock host
   */
  static setMockHost(host: string): void {
    this.mockHost = host
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
    // Check if 'confirmed' was explicitly provided (including null)
    const hasExplicitConfirmed = options && 'confirmed' in options
    
    this.mockTransactions.set(id, {
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
    this.mockTransactions.delete(id)
  }

  /**
   * Get all created transactions (useful for verifying createTransaction was called)
   */
  static getCreatedTransactions(): MockCreatedTransaction[] {
    return [...this.createdTransactions]
  }

  /**
   * Get the last created transaction
   */
  static getLastCreatedTransaction(): MockCreatedTransaction | undefined {
    return this.createdTransactions[this.createdTransactions.length - 1]
  }

  // ============================================
  // Implementation of BaseArweaveClient methods
  // ============================================

  static getArweaveClient(): GraphQLClient {
    // Return a mock GraphQL client that doesn't actually make requests
    return new GraphQLClient(`https://${this.mockHost}/graphql`)
  }

  static async getTransactionStatus(transactionId: string): Promise<TransactionStatus> {
    const tx = this.mockTransactions.get(transactionId)
    
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

  static async getTransactionData(
    transactionId: string,
    options?: GetDataOptions
  ): Promise<Uint8Array | string> {
    const tx = this.mockTransactions.get(transactionId)
    
    if (!tx) {
      throw new Error(`Transaction ${transactionId} not found`)
    }

    if (options?.string) {
      return new TextDecoder().decode(tx.data)
    }

    return tx.data
  }

  static async getTransactionTags(transactionId: string): Promise<TransactionTag[]> {
    const tx = this.mockTransactions.get(transactionId)
    
    if (!tx) {
      return []
    }

    return tx.tags
  }

  static async createTransaction(
    data: string | Uint8Array,
    options?: CreateTransactionOptions
  ): Promise<any> {
    // Generate a mock transaction ID
    const id = `mock-tx-${++this.transactionIdCounter}`
    
    // Convert data to Uint8Array if string
    const dataArray = typeof data === 'string' 
      ? new TextEncoder().encode(data)
      : data

    const mockTx: MockCreatedTransaction = {
      id,
      data: dataArray,
      tags: options?.tags || [],
    }

    this.createdTransactions.push(mockTx)

    // Return a mock transaction object that mimics the Arweave transaction structure
    return {
      id,
      data: dataArray,
      tags: mockTx.tags.map(tag => ({ name: tag.name, value: tag.value })),
      addTag: (name: string, value: string) => {
        mockTx.tags.push({ name, value })
      },
    }
  }

  static async downloadFiles(params: DownloadFilesParams): Promise<DownloadResult[]> {
    const { transactionIds, excludedTransactions } = params
    const results: DownloadResult[] = []

    for (const transactionId of transactionIds) {
      // Skip excluded transactions
      if (excludedTransactions?.has(transactionId)) {
        continue
      }

      const tx = this.mockTransactions.get(transactionId)

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

export { MockArweaveClient }

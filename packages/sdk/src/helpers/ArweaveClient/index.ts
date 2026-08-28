import { BaseArweaveClient } from './BaseArweaveClient'
import Arweave from 'arweave'
import { isBrowser } from '../environment'

/** @deprecated Prefer BaseArweaveClient facade after configure() */
export const ArweaveClient = BaseArweaveClient

export const initArweaveClient = async () => {
  if (isBrowser()) {
    const { BrowserArweaveClient } = await import('../../browser/helpers/ArweaveClient')
    BaseArweaveClient.configure(new BrowserArweaveClient())
  }
}

/**
 * @deprecated Use BaseArweaveClient methods instead (getTransactionStatus, getTransactionData, createTransaction, etc.)
 * This function is kept for backward compatibility but will be removed in a future version.
 * The Arweave instance is now internal to the platform-specific ArweaveClient implementations.
 * 
 * Migration guide:
 * - For transaction status: BaseArweaveClient.getTransactionStatus(transactionId)
 * - For transaction data: BaseArweaveClient.getTransactionData(transactionId, options)
 * - For creating transactions: BaseArweaveClient.createTransaction(data, options)
 * - For transaction tags: BaseArweaveClient.getTransactionTags(transactionId)
 * 
 * @returns Arweave instance or undefined if not available
 */
export const getArweave = (): Arweave | undefined => {
  if (
    typeof window === 'undefined' ||
    !Arweave ||
    (typeof Arweave.init !== 'function' &&
      !('default' in Arweave && typeof (Arweave as any).default?.init === 'function'))
  ) {
    return
  }

  const hostToUse = BaseArweaveClient.getHost()
  const protocol = BaseArweaveClient.getProtocol()

  // Check if Arweave has a default export (ES modules) or is the class itself (CommonJS)
  if ('default' in Arweave && typeof (Arweave as any).default?.init === 'function') {
    return (Arweave as any).default.init({
      host: hostToUse,
      protocol,
    })
  }

  return Arweave.init({
    host: hostToUse,
    protocol,
  })
}

/**
 * @deprecated Use BaseArweaveClient.setHost() instead.
 * This function is kept for backward compatibility but will be removed in a future version.
 */
export const setArweaveDomain = (newDomain: string): void => {
  BaseArweaveClient.setPreferredReadGateway(newDomain)
}

/**
 * @deprecated Use BaseArweaveClient.getHost() instead.
 * This function is kept for backward compatibility but will be removed in a future version.
 */
export const getArweaveDomain = (): string => {
  return BaseArweaveClient.getHost()
}

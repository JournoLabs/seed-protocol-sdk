import { setAdditionalSyncAddresses, setGetPublisherForNewSeeds, setRevokeExecutor } from '@seedprotocol/sdk'
import {
  THIRDWEB_ACCOUNT_FACTORY_ADDRESS,
  EAS_CONTRACT_ADDRESS,
} from './helpers/constants'
import { getConnectedManagedAccountAddress } from './helpers/thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { revokeAttestations } from './services/revoke/revokeAttestations'

/** Serialized upload item for Arweave signing (input to callback or used internally with JWK) */
export interface SerializedPublishUpload {
  versionLocalId: string
  itemPropertyName: string
  transactionJson: Record<string, unknown>
}

/** Result from Arweave signing (signed transaction + metadata) */
export interface ArweaveTransactionInfoResult {
  transaction: Record<string, unknown> & { chunks?: unknown }
  versionId: string
  modelName: string
}

export interface PublishConfig {
  thirdwebClientId: string
  /** Upload API base URL (e.g. from VITE_UPLOAD_API_BASE_URL or NEXT_PUBLIC_UPLOAD_API_BASE_URL) */
  uploadApiBaseUrl: string
  /**
   * Use integer indices instead of string localId/publishLocalId for multiPublish (gas-efficient).
   * Set to true when using the new contract that expects uint256 localIdIndex/publishLocalIdIndex.
   * Default: false (uses string-based payload for backward compatibility).
   */
  useIntegerLocalIds?: boolean
  /**
   * Bypass the SeedProtocol contract and call EAS attest/multiAttest directly from the user's wallet.
   * Default: false (uses contract multiPublish).
   */
  useDirectEas?: boolean
  /**
   * Optional IModularCore module to ensure is installed on the connected account contract.
   * When set, onConnect will check getInstalledModules and install if missing.
   */
  modularAccountModuleContract?: string
  /** Optional module install data (default "0x"). Used with modularAccountModuleContract. */
  modularAccountModuleData?: string
  /**
   * Use the modular executor for multiPublish.
   * Default: false (uses the smart wallet executor).
   */
  useModularExecutor?: boolean
  /**
   * Sign Arweave upload transactions. Use for backend API, ArConnect, or custom flows.
   * Takes serialized uploads, returns signed transactions with chunks.
   */
  signArweaveTransactions?: (
    uploads: SerializedPublishUpload[]
  ) => Promise<ArweaveTransactionInfoResult[]>
  /**
   * Arweave JWK for in-process signing. App loads from env, secure storage, etc.
   * Prefer signArweaveTransactions for web apps (avoids exposing key in browser).
   */
  arweaveJwk?: { kty: string; n: string; e: string; d?: string; [key: string]: unknown }
}

/** Use window (renderer) or globalThis so config survives across module instances (e.g. Vite chunks). */
function getConfig(): PublishConfig | null {
  if (typeof window !== 'undefined' && window.__SEED_PUBLISH_CONFIG__ != null) {
    return window.__SEED_PUBLISH_CONFIG__
  }
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>
    const v = g['__SEED_PUBLISH_CONFIG__']
    if (v != null) return v as PublishConfig
  }
  return null
}

function setConfig(c: PublishConfig | null): void {
  if (typeof window !== 'undefined') {
    window.__SEED_PUBLISH_CONFIG__ = c
  }
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>)['__SEED_PUBLISH_CONFIG__'] = c
  }
}

export function initPublish(c: PublishConfig): void {
  setConfig(c)
  setGetPublisherForNewSeeds(async () => {
    try {
      return await getConnectedManagedAccountAddress(optimismSepolia)
    } catch {
      return undefined
    }
  })
  setRevokeExecutor(revokeAttestations)
  setAdditionalSyncAddresses(async () => {
    const config = getConfig()
    if (config?.useModularExecutor && config?.modularAccountModuleContract) {
      return [config.modularAccountModuleContract]
    }
    return []
  })
}

export interface ResolvedPublishConfig extends PublishConfig {
  thirdwebAccountFactoryAddress: string
  uploadApiBaseUrl: string
  easContractAddress: string
  useIntegerLocalIds: boolean
  useDirectEas: boolean
  modularAccountModuleData: string
  useModularExecutor: boolean
}

export function getPublishConfig(): ResolvedPublishConfig {
  const config = getConfig()
  if (!config) {
    throw new Error(
      '@seedprotocol/publish: Call initPublish({ thirdwebClientId, uploadApiBaseUrl }) before using the package'
    )
  }
  return {
    ...config,
    thirdwebAccountFactoryAddress: THIRDWEB_ACCOUNT_FACTORY_ADDRESS,
    easContractAddress: EAS_CONTRACT_ADDRESS,
    useIntegerLocalIds: config.useIntegerLocalIds ?? false,
    useDirectEas: config.useDirectEas ?? false,
    modularAccountModuleData: config.modularAccountModuleData ?? '0x',
    useModularExecutor: config.useModularExecutor ?? false,
  }
}

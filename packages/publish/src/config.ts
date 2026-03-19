import { setAdditionalSyncAddresses, setGetPublisherForNewSeeds, setRevokeExecutor } from '@seedprotocol/sdk'
import { getConnectedManagedAccountAddress } from './helpers/thirdweb'
import { optimismSepolia } from 'thirdweb/chains'
import { revokeAttestations } from './services/revoke/revokeAttestations'
import {
  THIRDWEB_ACCOUNT_FACTORY_ADDRESS,
  EAS_CONTRACT_ADDRESS,
} from './helpers/constants'
import { ethers } from 'ethers'

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

/** Result from DataItem signing (compatible shape for createAttestations) */
export interface ArweaveDataItemInfoResult {
  transaction: { id: string }
  versionId?: string
  modelName?: string
}

export interface PublishConfig {
  thirdwebClientId: string
  /** Upload API base URL (e.g. from VITE_UPLOAD_API_BASE_URL or NEXT_PUBLIC_UPLOAD_API_BASE_URL). Also used for bundler when useArweaveBundler is true. */
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
   * EXPERIMENTAL: Use Arweave bundler for instant uploads instead of reimbursement + chunk upload.
   * When true, skips sendReimbursementRequest, pollForConfirmation, and chunk-by-chunk uploadData.
   * Uses uploadApiBaseUrl for the bundler endpoint. Not yet validated for production.
   */
  useArweaveBundler?: boolean
  /**
   * Optional fallback: Sign Arweave upload transactions (non-bundler path). Prefer passing at createPublish time.
   */
  signArweaveTransactions?: (
    uploads: SerializedPublishUpload[]
  ) => Promise<ArweaveTransactionInfoResult[]>
  /**
   * Optional fallback: Arweave JWK for in-process signing (non-bundler path). Prefer passing at createPublish time.
   */
  arweaveJwk?: { kty: string; n: string; e: string; d?: string; [key: string]: unknown }
  /**
   * Optional fallback: Signer for DataItem creation when useArweaveBundler is true. Prefer passing at createPublish time.
   */
  dataItemSigner?: ethers.Wallet | import('thirdweb/wallets').Account
  /**
   * Optional fallback: Sign DataItems when useArweaveBundler is true. Prefer passing at createPublish time.
   */
  signDataItems?: (
    uploads: import('./services/publish/helpers/getPublishUploadData').PublishUploadData[]
  ) => Promise<ArweaveDataItemInfoResult[]>
}

/** Options passed at createPublish time. Signers here override config fallbacks. */
export interface CreatePublishOptions {
  /** Required when useArweaveBundler: sign DataItems (wallet flow) */
  signDataItems?: (
    uploads: import('./services/publish/helpers/getPublishUploadData').PublishUploadData[]
  ) => Promise<ArweaveDataItemInfoResult[]>
  /** Required when useArweaveBundler: signer for DataItems (backend/script flow) */
  dataItemSigner?: ethers.Wallet | import('thirdweb/wallets').Account
  /** Required when NOT useArweaveBundler: sign Arweave transactions */
  signArweaveTransactions?: (
    uploads: SerializedPublishUpload[]
  ) => Promise<ArweaveTransactionInfoResult[]>
  /** Required when NOT useArweaveBundler: JWK for in-process signing */
  arweaveJwk?: { kty: string; n: string; e: string; d?: string; [key: string]: unknown }
}

/** Internal: module-level config ref set by PublishProvider on mount. */
let configRef: PublishConfig | null = null

/**
 * Internal: Set config ref. Called by PublishProvider on mount or initPublish.
 */
export function setConfigRef(c: PublishConfig | null): void {
  configRef = c
}

/**
 * Internal: Get current config ref. Used by PublishProvider when config is not passed.
 */
export function getConfigRef(): PublishConfig | null {
  return configRef
}

/**
 * Initialize the publish package. Call once before using PublishManager or other publish APIs.
 * Registers the config and SDK hooks (revoke executor, getPublisherForNewSeeds, etc.).
 * For React apps, you can alternatively pass config to PublishProvider.
 */
export function initPublish(c: PublishConfig): void {
  setConfigRef(c)
  setGetPublisherForNewSeeds(async () => {
    try {
      return await getConnectedManagedAccountAddress(optimismSepolia)
    } catch {
      return undefined
    }
  })
  setRevokeExecutor(revokeAttestations)
  setAdditionalSyncAddresses(async () => {
    if (c.useModularExecutor && c.modularAccountModuleContract) {
      return [c.modularAccountModuleContract]
    }
    return []
  })
}

/** Alias for initPublish. Use initPublish for the primary API. */
export const configurePublish = initPublish

export interface ResolvedPublishConfig extends PublishConfig {
  thirdwebAccountFactoryAddress: string
  uploadApiBaseUrl: string
  easContractAddress: string
  useIntegerLocalIds: boolean
  useDirectEas: boolean
  modularAccountModuleData: string
  useModularExecutor: boolean
  useArweaveBundler: boolean
}

/**
 * Internal: Get resolved config. Reads from ref set by initPublish or PublishProvider.
 * Throws if neither has been called.
 */
export function getPublishConfig(): ResolvedPublishConfig {
  const config = configRef
  if (!config) {
    throw new Error(
      '@seedprotocol/publish: Call initPublish() or ensure PublishProvider is mounted with config before using the publish package'
    )
  }
  const useArweaveBundler = config.useArweaveBundler ?? false
  return {
    ...config,
    thirdwebAccountFactoryAddress: THIRDWEB_ACCOUNT_FACTORY_ADDRESS,
    easContractAddress: EAS_CONTRACT_ADDRESS,
    useIntegerLocalIds: config.useIntegerLocalIds ?? false,
    useDirectEas: config.useDirectEas ?? false,
    modularAccountModuleData: config.modularAccountModuleData ?? '0x',
    useModularExecutor: config.useModularExecutor ?? false,
    useArweaveBundler,
  }
}

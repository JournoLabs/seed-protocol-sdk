import {
  THIRDWEB_ACCOUNT_FACTORY_ADDRESS,
  EAS_CONTRACT_ADDRESS,
} from './helpers/constants'

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

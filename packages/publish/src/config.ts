import {
  DEFAULT_ARWEAVE_GRAPHQL_URL,
  setAdditionalSyncAddresses,
  setGetPublisherForNewSeeds,
  setRevokeExecutor,
  whenLeaderTab,
  type TransactionTag,
} from '@seedprotocol/sdk'
import type { Chain } from 'viem'
import { revokeAttestations } from './services/revoke/revokeAttestations'
import {
  configureEasReadChain,
  expectEasReadChain,
  resolveEasChainDeployment,
  type EasChainDeployment,
} from '@seedprotocol/eas'
import { MANAGED_ACCOUNT_FACTORY_ADDRESSES } from './helpers/constants'
import { ethers } from 'ethers'
import { DEFAULT_PUBLISH_CHAIN } from './helpers/defaultChain'
import { getPublishWallet } from './helpers/publishWalletRegistry'

// initPublish will set the chain. Until then the SDK's EAS sync waits instead of reading the
// default chain into a local DB that publish is about to point elsewhere.
expectEasReadChain('publish')

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

export type PublishAccountMode = 'eoa' | 'eip7702'

export interface ThirdwebWalletOptions {
  /**
   * Bundler for the managed (EIP-4337, EntryPoint v0.6) smart account's UserOps. Defaults to
   * Thirdweb's hosted bundler for the chain; required on a local chain. This is the bundler a
   * local twin uses, not the top-level {@link PublishConfig.bundlerUrl}.
   */
  bundlerUrl?: string
  /**
   * Sponsor gas through Thirdweb: the managed smart account's UserOps and, in `'EIP7702'` mode,
   * the in-app EOA's transactions. Default `true`. Set `false` where Thirdweb's paymaster is
   * unavailable (local chains); the accounts then pay their own gas and must hold ETH.
   */
  sponsorGas?: boolean
  /**
   * How the user's in-app EOA (the managed account's admin) sends its own transactions, such as
   * installing the Seed executor: `'EIP7702'` (default) goes through Thirdweb's hosted EIP-7702
   * service (gas-sponsored per `sponsorGas`); `'EOA'` sends plain transactions and needs ETH.
   * A local chain requires `'EOA'`: the wallet throws for `'EIP7702'` there. The address is the
   * same either way.
   */
  modularWalletMode?: 'EIP7702' | 'EOA'
}

export interface PublishConfig {
  /**
   * Thirdweb client id — only required when using `@seedprotocol/publish/thirdweb`.
   * When set without `rpcUrl`, the public client falls back to Thirdweb’s RPC edge.
   * Browser client ids are usually locked to app origins; Node servers should also set
   * `thirdwebSecretKey` or those RPC and bundler calls return 401.
   */
  thirdwebClientId?: string
  /**
   * Thirdweb secret key for server-side clients. Sent as `x-secret-key` on viem reads
   * of the Thirdweb RPC URL, and passed to `createThirdwebClient` for sends.
   * Do not ship this to the browser. It does not replace `rpcUrl` or `thirdwebClientId`
   * when building the viem RPC URL.
   */
  thirdwebSecretKey?: string
  /**
   * Viem chain for reads, writes and wallet connection. Defaults to Optimism Sepolia.
   * Any EVM chain with EAS deployed works. Chains in `EAS_CHAIN_DEPLOYMENTS` (`@seedprotocol/eas`)
   * resolve contract addresses automatically; others need {@link easContractAddress} and
   * {@link schemaRegistryAddress}.
   */
  chain?: Chain
  /** EAS contract on {@link chain}. Defaults to the known deployment for `chain.id`. */
  easContractAddress?: string
  /** EAS SchemaRegistry on {@link chain}. Defaults to the known deployment for `chain.id`. */
  schemaRegistryAddress?: string
  /**
   * Thirdweb ManagedAccount factory on {@link chain}. Only used by managed / modular account flows.
   * Built in for Optimism Sepolia; required on other chains when those flows are enabled.
   */
  managedAccountFactoryAddress?: string
  /**
   * JSON-RPC URL for the publish chain. Required when `thirdwebClientId` is unset.
   * Prefer a public chain RPC from Node. A domain-locked client id in the default
   * Thirdweb URL returns 401 unless `thirdwebSecretKey` is also set.
   * Thirdweb wallets and contract calls use it too; without it they use Thirdweb's RPC edge.
   */
  rpcUrl?: string
  /**
   * Thirdweb in-app wallet settings (`@seedprotocol/publish/thirdweb`). Defaults suit Thirdweb-hosted
   * chains; a local chain (e.g. the OP Sepolia twin) needs `bundlerUrl`, `sponsorGas: false` and
   * `modularWalletMode: 'EOA'`.
   */
  thirdweb?: ThirdwebWalletOptions
  /**
   * EntryPoint v0.8 bundler for the permissionless EIP-7702 `SeedTxSender` used by non-Thirdweb
   * wallets. Setting it switches `accountMode` to `eip7702`. Not used by Thirdweb wallets: a local
   * twin's (v0.6) bundler goes in {@link ThirdwebWalletOptions.bundlerUrl}. A bundler that
   * reports no v0.8 support is rejected when the sender is created.
   */
  bundlerUrl?: string
  /**
   * Paymaster / sponsorship endpoint for permissionless EIP-7702 sends.
   */
  paymasterUrl?: string
  /**
   * How non-Thirdweb wallets submit txs. Defaults to `eip7702` when `bundlerUrl` is set, else `eoa`.
   */
  accountMode?: PublishAccountMode
  /** Upload API base URL (e.g. from VITE_UPLOAD_API_BASE_URL or NEXT_PUBLIC_UPLOAD_API_BASE_URL). Also used for bundler when useArweaveBundler is true. */
  uploadApiBaseUrl: string
  /**
   * Gateway transport for publish + read paths. Prefer resolving once via
   * `resolveSeedGatewayEndpoints(seedGatewayConfigFromSeedConfig(config))` at app bootstrap
   * and passing `uploadApiBaseUrl` / `arweaveGraphqlUrl` from the result.
   */
  gatewayTransport?: 'http-gateway' | 'hyper' | 'hybrid'
  /** Operator Gateway Hyper key (z32) — informational; sidecar is configured separately. */
  gatewayHyperKey?: string
  /**
   * Optional origin for verifying uploads via `GET /api/upload/arweave/data/:id`.
   * Defaults to {@link uploadApiBaseUrl} (e.g. set `ARWEAVE_UPLOAD_API_BASE_URL` as `uploadApiBaseUrl`).
   */
  arweaveUploadVerificationBaseUrl?: string
  /**
   * Arweave gateway GraphQL URL for resolving L1 bundle tx ids after bundler upload.
   * Defaults to {@link DEFAULT_ARWEAVE_GRAPHQL_URL}.
   */
  arweaveGraphqlUrl?: string
  /**
   * Bypass the SeedProtocol contract and call EAS attest/multiAttest directly from the user's wallet.
   * Default: false (uses contract multiPublish).
   */
  useDirectEas?: boolean
  /**
   * Seed executor module (SeedProtocolExecutor). Must match the executor pinned by the
   * ManagedAccount's `SeedExecutorRouterExtension` (`readFactorySeedExecutor` reads it from the
   * factory). When set, onConnect / publish prep install it with `installSeedExecutor()` if
   * missing; accounts without the extension are skipped.
   */
  modularAccountModuleContract?: string
  /** Unused: `installSeedExecutor()` takes no install data. */
  modularAccountModuleData?: string
  /**
   * Use the modular executor for multiPublish.
   * Default: false (uses the smart wallet executor).
   */
  useModularExecutor?: boolean
  /**
   * When true (and `useModularExecutor`), attempts to deploy / bootstrap the modular in-app wallet’s
   * EIP-7702 smart account on the publish chain via Thirdweb’s `deploySmartAccount` when bytecode is still empty.
   * When **undefined** and `useModularExecutor` is true, defaults to **true**. Set explicitly to **false** to surface
   * an error instead of auto-deploying.
   */
  autoDeployEip7702ModularAccount?: boolean
  /**
   * When true (and `useModularExecutor`), attempts to deploy the ManagedAccount via the factory
   * if it is not yet deployed on the publish chain. Default: false (surface `managed_not_ready` instead).
   */
  autoDeployManagedAccount?: boolean
  /**
   * Optional override for automatic ManagedAccount factory deploy when {@link autoDeployManagedAccount} is true.
   * When unset, uses Thirdweb `deploySmartAccount` on the managed EIP-4337 in-app wallet account.
   */
  deployManagedAccount?: (params: {
    managedAddress: string
    managedSigningAccount: import('./helpers/seedSigner').PublishWallet
  }) => Promise<void>
  /**
   * Called when optional wallet setup steps fail after connect (e.g. executor module install).
   */
  onWalletSetupWarning?: (error: unknown) => void
  /**
   * EXPERIMENTAL: Use Arweave bundler for instant uploads instead of reimbursement + chunk upload.
   * When true, skips sendReimbursementRequest, pollForConfirmation, and chunk-by-chunk uploadData.
   * Uses uploadApiBaseUrl for the bundler endpoint. Not yet validated for production.
   */
  useArweaveBundler?: boolean
  /**
   * Tags appended to every Arweave upload after Content-SHA-256 / Content-Type (e.g. App-Name).
   * Merged at publish time with {@link CreatePublishOptions.arweaveUploadTags} as
   * `[...config, ...options]`.
   */
  arweaveUploadTags?: TransactionTag[]
  /**
   * Default Html embedded data-URI policy for publishes when not overridden per {@link CreatePublishOptions}.
   * Default behavior when unset: `materialize`.
   */
  htmlEmbeddedDataUriPolicy?: import('./types').HtmlEmbeddedDataUriPolicy
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
  dataItemSigner?: ethers.Wallet | import('./helpers/seedSigner').SeedSigner
  /**
   * Optional fallback: Sign DataItems when useArweaveBundler is true. Prefer passing at createPublish time.
   * Each upload includes `tags` (content + configured {@link arweaveUploadTags}); forward them into the DataItem.
   */
  signDataItems?: (
    uploads: import('./services/publish/helpers/getPublishUploadData').PublishUploadData[]
  ) => Promise<ArweaveDataItemInfoResult[]>
  /**
   * Optional USD spot prices for publish cost estimates. When unset, Coinbase ETH-USD / AR-USD spots are used.
   * Results are cached for 60s.
   */
  getTokenPrices?: () => Promise<{ ethUsd: number; arUsd: number }>
  /**
   * Called when an author publish run reaches success with the resolved batch UID list.
   * Tool backends use this to call {@link import('./services/publishedBy').attestPublishedBy}.
   * Per-publish {@link CreatePublishOptions.onPublished} overrides this when set.
   */
  onPublished?: import('./services/publishedBy').OnPublishedCallback
}

/** Options passed at createPublish time. Signers here override config fallbacks. */
export interface CreatePublishOptions {
  /** `patch` (default): pending properties only. `new_version`: new Version attestation + all properties. */
  publishMode?: import('./types').PublishMode
  /**
   * Required when useArweaveBundler: sign DataItems (wallet flow).
   * Use each upload's `tags` when building the signed DataItem.
   */
  signDataItems?: (
    uploads: import('./services/publish/helpers/getPublishUploadData').PublishUploadData[]
  ) => Promise<ArweaveDataItemInfoResult[]>
  /** Required when useArweaveBundler: signer for DataItems (backend/script flow) */
  dataItemSigner?: ethers.Wallet | import('./helpers/seedSigner').SeedSigner
  /** Required when NOT useArweaveBundler: sign Arweave transactions */
  signArweaveTransactions?: (
    uploads: SerializedPublishUpload[]
  ) => Promise<ArweaveTransactionInfoResult[]>
  /** Required when NOT useArweaveBundler: JWK for in-process signing */
  arweaveJwk?: { kty: string; n: string; e: string; d?: string; [key: string]: unknown }
  /**
   * Extra tags for this publish only, appended after {@link PublishConfig.arweaveUploadTags}.
   * Resolved order: `[...initPublishTags, ...theseTags]`.
   */
  arweaveUploadTags?: TransactionTag[]
  /**
   * Default for Html embedded data-URI handling when a property does not set `htmlEmbeddedDataUriPolicy`.
   * Default: `materialize`.
   */
  htmlEmbeddedDataUriPolicy?: import('./types').HtmlEmbeddedDataUriPolicy
  /**
   * Called when this publish run succeeds with the resolved Seed/Version/property UID batch.
   * Overrides {@link PublishConfig.onPublished} when both are set.
   */
  onPublished?: import('./services/publishedBy').OnPublishedCallback
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
  // Fail fast on chains without a known EAS deployment and no address overrides.
  const easChain = resolvePublishEasChain(c)
  // Point SDK reads (EAS sync, schema lookups) at the chain we publish to. Throws when
  // SeedConfig.eas.chainId names a different chain.
  configureEasReadChain('publish', { chainId: easChain.chainId, indexerUrl: easChain.indexerUrl })
  setConfigRef(c)
  setGetPublisherForNewSeeds(async () => {
    const wallet = getPublishWallet()
    if (wallet?.publisherAddress) return wallet.publisherAddress
    if (wallet?.signer?.address) return wallet.signer.address
    return undefined
  })
  setRevokeExecutor(revokeAttestations)
  // Polls every 45 s; one tab is enough (docs/MULTI_TAB.md). Starts on takeover if this tab
  // isn't the leader yet.
  void whenLeaderTab()
    .then(() => import('./services/arweaveL1Finalize/worker'))
    .then((m) => {
      m.startArweaveL1FinalizeWorker()
    })
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
  /**
   * ManagedAccount factory on the publish chain, or undefined when none is known for this chain.
   * Use {@link requireManagedAccountFactoryAddress} where a factory is mandatory.
   */
  thirdwebAccountFactoryAddress: string | undefined
  uploadApiBaseUrl: string
  /** Resolved verification origin (defaults to uploadApiBaseUrl). */
  arweaveUploadVerificationBaseUrl: string
  /** Resolved GraphQL endpoint for L1 tx resolution (defaults to DEFAULT_ARWEAVE_GRAPHQL_URL). */
  arweaveGraphqlUrl: string
  easContractAddress: string
  schemaRegistryAddress: string
  /** EAS deployment for the publish chain (addresses, indexer and explorer URLs). */
  easChain: EasChainDeployment
  useDirectEas: boolean
  modularAccountModuleData: string
  useModularExecutor: boolean
  useArweaveBundler: boolean
  /** Resolved: defaults to false. */
  autoDeployManagedAccount: boolean
  /**
   * Resolved: when `useModularExecutor` is true, defaults to true unless explicitly false.
   */
  autoDeployEip7702ModularAccount: boolean
  /** Resolved viem chain (defaults to Optimism Sepolia; see `DEFAULT_PUBLISH_CHAIN`). */
  chain: Chain
  /** Resolved account mode for non-Thirdweb senders. */
  accountMode: PublishAccountMode
  /** Resolved Thirdweb wallet settings (defaults applied). */
  thirdweb: ResolvedThirdwebWalletOptions
}

export type ResolvedThirdwebWalletOptions = {
  bundlerUrl: string | undefined
  sponsorGas: boolean
  modularWalletMode: 'EIP7702' | 'EOA'
}

/** Applies defaults to {@link PublishConfig.thirdweb}. */
export function resolveThirdwebWalletOptions(
  config: Pick<PublishConfig, 'thirdweb'> | null | undefined,
): ResolvedThirdwebWalletOptions {
  const tw = config?.thirdweb ?? {}
  return {
    bundlerUrl: tw.bundlerUrl?.trim() || undefined,
    sponsorGas: tw.sponsorGas ?? true,
    modularWalletMode: tw.modularWalletMode ?? 'EIP7702',
  }
}

/**
 * Returns the resolved publish config: defaults, env-driven fields, and
 * {@link ResolvedPublishConfig.autoDeployEip7702ModularAccount}.
 *
 * Reads the ref set by {@link initPublish} or {@link PublishProvider} with a `config` prop.
 * **Throws** if publish has not been initialized (same error as other publish APIs).
 */
export function getPublishConfig(): ResolvedPublishConfig {
  const config = configRef
  if (!config) {
    throw new Error(
      '@seedprotocol/publish: Call initPublish() or ensure PublishProvider is mounted with config before using the publish package'
    )
  }
  const useArweaveBundler = config.useArweaveBundler ?? false
  const arweaveUploadVerificationBaseUrl =
    config.arweaveUploadVerificationBaseUrl ?? config.uploadApiBaseUrl
  const arweaveGraphqlUrl = config.arweaveGraphqlUrl ?? DEFAULT_ARWEAVE_GRAPHQL_URL
  const useModularExecutor = config.useModularExecutor ?? false
  const chain = config.chain ?? DEFAULT_PUBLISH_CHAIN
  const easChain = resolvePublishEasChain(config)
  const accountMode: PublishAccountMode =
    config.accountMode ?? (config.bundlerUrl ? 'eip7702' : 'eoa')
  return {
    ...config,
    thirdwebAccountFactoryAddress:
      config.managedAccountFactoryAddress ?? MANAGED_ACCOUNT_FACTORY_ADDRESSES[chain.id],
    easContractAddress: easChain.easContractAddress,
    schemaRegistryAddress: easChain.schemaRegistryAddress,
    easChain,
    useDirectEas: config.useDirectEas ?? false,
    modularAccountModuleData: config.modularAccountModuleData ?? '0x',
    useModularExecutor,
    useArweaveBundler,
    arweaveUploadVerificationBaseUrl,
    arweaveGraphqlUrl,
    autoDeployManagedAccount: config.autoDeployManagedAccount ?? false,
    autoDeployEip7702ModularAccount: resolveAutoDeployEip7702ModularAccount(config, useModularExecutor),
    chain,
    accountMode,
    thirdweb: resolveThirdwebWalletOptions(config),
  }
}

/**
 * EAS deployment for the configured chain, with {@link PublishConfig.easContractAddress} /
 * {@link PublishConfig.schemaRegistryAddress} overrides applied.
 */
export function resolvePublishEasChain(config: PublishConfig): EasChainDeployment {
  const chain = config.chain ?? DEFAULT_PUBLISH_CHAIN
  try {
    return resolveEasChainDeployment(chain.id, {
      name: chain.name,
      easContractAddress: config.easContractAddress as `0x${string}` | undefined,
      schemaRegistryAddress: config.schemaRegistryAddress as `0x${string}` | undefined,
    })
  } catch (error) {
    throw new Error(
      `@seedprotocol/publish: ${chain.name} (chain ${chain.id}) has no known EAS deployment. Pass easContractAddress and schemaRegistryAddress in initPublish / PublishProvider config.`,
      { cause: error },
    )
  }
}

/** ManagedAccount factory for the publish chain; throws when none is configured. */
export function requireManagedAccountFactoryAddress(): string {
  const { thirdwebAccountFactoryAddress, chain } = getPublishConfig()
  if (!thirdwebAccountFactoryAddress) {
    throw new Error(
      `@seedprotocol/publish: no ManagedAccount factory is known for ${chain.name} (chain ${chain.id}). Pass managedAccountFactoryAddress in publish config, or use the EOA / direct EAS path.`,
    )
  }
  return thirdwebAccountFactoryAddress
}

/** @internal Exported for unit tests. */
export function resolveAutoDeployEip7702ModularAccount(
  config: PublishConfig,
  useModularExecutor: boolean,
): boolean {
  if (config.autoDeployEip7702ModularAccount === true) return true
  if (config.autoDeployEip7702ModularAccount === false) return false
  return useModularExecutor
}

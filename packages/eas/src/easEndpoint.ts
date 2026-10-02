import { DEFAULT_EAS_CHAIN_ID, getEasChainDeployment } from './chains.js'

/**
 * Which EAS chain / indexer the read side (sync, schema lookups) talks to.
 *
 * Two packages can set it: the SDK (`SeedConfig.eas`) and `@seedprotocol/publish`
 * (`PublishConfig.chain`). Each writes its own slot, so init order does not matter.
 * Conflicting chain ids throw instead of silently reading one chain while writing another.
 *
 * Indexer URL precedence: SDK `indexerUrl` > `EAS_ENDPOINT` / `NEXT_PUBLIC_EAS_ENDPOINT` env >
 * the configured chain's known indexer > Optimism Sepolia.
 */
export type EasReadChainSource = 'sdk' | 'publish'

export interface EasReadChainSetting {
  chainId?: number
  /** EAS indexer GraphQL endpoint. Required for chains without a known indexer. */
  indexerUrl?: string
}

const settings: Record<EasReadChainSource, EasReadChainSetting> = { sdk: {}, publish: {} }
let warnedEnvOverride = false

function readEnvEndpoint(): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env) {
      const v = process.env.NEXT_PUBLIC_EAS_ENDPOINT || process.env.EAS_ENDPOINT
      if (v) return v
    }
  } catch {
    // process.env access can throw in some bundler shims
  }
  const windowEnv = (globalThis as { window?: { env?: Record<string, string | undefined> } }).window?.env
  return windowEnv?.NEXT_PUBLIC_EAS_ENDPOINT || windowEnv?.EAS_ENDPOINT || undefined
}

/**
 * Set the EAS read chain for one source. Throws when the other source already set a
 * different chain id; the previous setting is kept in that case.
 */
export function configureEasReadChain(source: EasReadChainSource, setting: EasReadChainSetting): void {
  const other = settings[source === 'sdk' ? 'publish' : 'sdk']
  if (setting.chainId !== undefined && other.chainId !== undefined && setting.chainId !== other.chainId) {
    const [sdkId, publishId] = source === 'sdk' ? [setting.chainId, other.chainId] : [other.chainId, setting.chainId]
    throw new Error(
      `Seed Protocol chain mismatch: the SDK reads EAS on chain ${sdkId} but @seedprotocol/publish writes to chain ${publishId}. Use the same chain in SeedConfig.eas.chainId and PublishConfig.chain.`,
    )
  }
  settings[source] = { ...setting }
}

/** @internal Reset both sources (tests). */
export function resetEasReadChain(): void {
  settings.sdk = {}
  settings.publish = {}
  warnedEnvOverride = false
}

/** Chain id the read side follows (defaults to Optimism Sepolia). */
export function getEasReadChainId(): number {
  return settings.sdk.chainId ?? settings.publish.chainId ?? DEFAULT_EAS_CHAIN_ID
}

/** Resolved EAS indexer GraphQL endpoint. Throws when the chain has no known indexer. */
export function getEasEndpoint(): string {
  if (settings.sdk.indexerUrl) return settings.sdk.indexerUrl

  const chainId = getEasReadChainId()
  const knownIndexer = getEasChainDeployment(chainId)?.indexerUrl
  const env = readEnvEndpoint()
  if (env) {
    if (knownIndexer && knownIndexer !== env && chainId !== DEFAULT_EAS_CHAIN_ID && !warnedEnvOverride) {
      warnedEnvOverride = true
      console.warn(
        `[Seed Protocol] EAS_ENDPOINT (${env}) overrides the indexer for chain ${chainId} (${knownIndexer}). Make sure it indexes chain ${chainId}, or set SeedConfig.eas.indexerUrl.`,
      )
    }
    return env
  }

  const url = knownIndexer ?? settings.publish.indexerUrl
  if (!url) {
    throw new Error(
      `No EAS indexer is known for chain ${chainId}. Set SeedConfig.eas.indexerUrl (or the EAS_ENDPOINT env var).`,
    )
  }
  return url
}

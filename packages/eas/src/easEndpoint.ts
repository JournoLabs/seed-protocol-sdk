import { DEFAULT_EAS_CHAIN_ID, getEasChainDeployment } from './chains.js'

/**
 * Which EAS chain / indexer the read side (sync, schema lookups) talks to.
 *
 * Three sources can set it, each in its own slot so init order does not matter:
 * - `sdk`: `SeedConfig.eas`
 * - `publish`: `PublishConfig.chain`
 * - `localDb`: the chain the SDK's local database already holds data from (lowest priority;
 *   lets reads start on the right chain before publish is initialized)
 * Conflicting chain ids throw instead of silently reading one chain while writing another.
 * Below those, the `EAS_CHAIN_ID` / `NEXT_PUBLIC_EAS_CHAIN_ID` env var sets the chain for
 * processes without SDK or publish config (e.g. a feed server); the default is Optimism Sepolia.
 *
 * Indexer URL precedence: SDK `indexerUrl` > `EAS_ENDPOINT` / `NEXT_PUBLIC_EAS_ENDPOINT` env >
 * the configured chain's known indexer > Optimism Sepolia.
 */
export type EasReadChainSource = 'sdk' | 'publish' | 'localDb'

export interface EasReadChainSetting {
  chainId?: number
  /** EAS indexer GraphQL endpoint. Required for chains without a known indexer. */
  indexerUrl?: string
}

const settings: Record<EasReadChainSource, EasReadChainSetting> = { sdk: {}, publish: {}, localDb: {} }
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

function readEnvChainId(): number | undefined {
  let raw: string | undefined
  try {
    if (typeof process !== 'undefined' && process.env) {
      raw = process.env.NEXT_PUBLIC_EAS_CHAIN_ID || process.env.EAS_CHAIN_ID
    }
  } catch {
    // process.env access can throw in some bundler shims
  }
  const parsed = Number(raw)
  return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Set the EAS read chain for one source. Throws when the other source already set a
 * different chain id; the previous setting is kept in that case.
 */
export function configureEasReadChain(source: EasReadChainSource, setting: EasReadChainSetting): void {
  const chainId = setting.chainId
  if (chainId !== undefined) {
    for (const other of Object.keys(settings) as EasReadChainSource[]) {
      const otherId = settings[other].chainId
      if (other !== source && otherId !== undefined && otherId !== chainId) {
        throw new Error(chainMismatchMessage({ [source]: chainId, [other]: otherId }))
      }
    }
  }
  settings[source] = { ...setting }
}

function chainMismatchMessage(ids: Partial<Record<EasReadChainSource, number>>): string {
  if (ids.localDb !== undefined) {
    const configured = ids.sdk ?? ids.publish
    return `Seed Protocol chain mismatch: the local database holds attestations from chain ${ids.localDb}, but the app is configured for chain ${configured}. Use a separate database per chain (SeedConfig.filesDir / dbConfig), clear the local database, or configure chain ${ids.localDb} again.`
  }
  return `Seed Protocol chain mismatch: the SDK reads EAS on chain ${ids.sdk} but @seedprotocol/publish writes to chain ${ids.publish}. Use the same chain in SeedConfig.eas.chainId and PublishConfig.chain.`
}

/**
 * True when a chain id was chosen explicitly (SDK, publish or `EAS_CHAIN_ID`), as opposed to
 * the default or the local DB's recorded chain.
 */
export function isEasReadChainConfigured(): boolean {
  return (
    settings.sdk.chainId !== undefined ||
    settings.publish.chainId !== undefined ||
    readEnvChainId() !== undefined
  )
}

/** @internal Reset all sources (tests). */
export function resetEasReadChain(): void {
  settings.sdk = {}
  settings.publish = {}
  settings.localDb = {}
  warnedEnvOverride = false
}

/** Chain id the read side follows (defaults to Optimism Sepolia). */
export function getEasReadChainId(): number {
  return (
    settings.sdk.chainId ??
    settings.publish.chainId ??
    settings.localDb.chainId ??
    readEnvChainId() ??
    DEFAULT_EAS_CHAIN_ID
  )
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

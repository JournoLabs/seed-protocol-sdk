import { DEFAULT_EAS_CHAIN_ID, EAS_CHAIN_DEPLOYMENTS, getEasChainDeployment } from './chains.js'

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
 * the configured chain's known indexer > Optimism Sepolia. An env URL that is another chain's
 * known indexer throws, so a leftover env var cannot make reads follow the wrong chain.
 */
export type EasReadChainSource = 'sdk' | 'publish' | 'localDb'

export interface EasReadChainSetting {
  chainId?: number
  /** EAS indexer GraphQL endpoint. Required for chains without a known indexer. */
  indexerUrl?: string
}

const settings: Record<EasReadChainSource, EasReadChainSetting> = { sdk: {}, publish: {}, localDb: {} }
/** Sources that have announced they will configure a chain (e.g. publish, at import). */
const expectedSources = new Set<EasReadChainSource>()
const settledListeners = new Set<() => void>()
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
  if (isEasReadChainSettled()) {
    for (const listener of [...settledListeners]) listener()
  }
}

/**
 * Announce that `source` will configure the chain later (e.g. `@seedprotocol/publish` calls
 * this when loaded, before `initPublish` runs). Until it does, {@link isEasReadChainSettled}
 * is false unless a chain is otherwise known, so EAS sync waits instead of reading the default.
 */
export function expectEasReadChain(source: EasReadChainSource): void {
  expectedSources.add(source)
}

/**
 * True when reads can start: a chain was set explicitly (SDK config, publish or `EAS_CHAIN_ID`),
 * the local DB recorded one, or no source that announced itself is still pending.
 */
export function isEasReadChainSettled(): boolean {
  if (isEasReadChainConfigured() || settings.localDb.chainId !== undefined) return true
  for (const source of expectedSources) {
    if (settings[source].chainId === undefined) return false
  }
  return true
}

/**
 * Resolves once {@link isEasReadChainSettled} is true. Resolves `false` after `timeoutMs`
 * when it never settles (the caller then proceeds on the current chain).
 */
export function whenEasReadChainSettled(timeoutMs: number): Promise<boolean> {
  if (isEasReadChainSettled()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const done = (settled: boolean) => {
      clearTimeout(timer)
      settledListeners.delete(onSettled)
      resolve(settled)
    }
    const onSettled = () => done(true)
    const timer = setTimeout(() => done(false), timeoutMs)
    settledListeners.add(onSettled)
  })
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
  expectedSources.clear()
  settledListeners.clear()
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
    const envChainId = chainIdOfKnownIndexer(env)
    if (envChainId !== undefined && envChainId !== chainId) {
      throw new Error(
        `Seed Protocol chain mismatch: EAS_ENDPOINT / NEXT_PUBLIC_EAS_ENDPOINT (${env}) is the indexer for chain ${envChainId}, but Seed reads EAS on chain ${chainId}. Unset it, point it at chain ${chainId}'s indexer, or set SeedConfig.eas.indexerUrl.`,
      )
    }
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

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

/** Chain whose known easscan indexer is `url`, if any. */
function chainIdOfKnownIndexer(url: string): number | undefined {
  const target = normalizeUrl(url)
  for (const [id, deployment] of Object.entries(EAS_CHAIN_DEPLOYMENTS)) {
    if (deployment.indexerUrl && normalizeUrl(deployment.indexerUrl) === target) return Number(id)
  }
  return undefined
}

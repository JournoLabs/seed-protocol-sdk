/**
 * No network in tests: requests to any host but this machine fail, and the test that made them
 * fails too, even when the code under test caught the error. A test that hit arweave.net on every
 * run flaked whenever the gateway was slow. Mock at the network boundary (stub `fetch`, a client
 * class, or start a local server), or name the file `*.live.test.ts` and skip it unless
 * SEED_LIVE_NETWORK_TESTS=1 (docs/TESTING.md).
 *
 * Installed by noNetwork.node.ts and noNetwork.browser.ts (vitest setup files) and noNetwork.bun.ts
 * (bun test preload). Runtime-neutral: no Node or DOM imports here.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'])

export function liveNetworkAllowed(): boolean {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ??
    (import.meta as { env?: Record<string, string | undefined> }).env
  return env?.SEED_LIVE_NETWORK_TESTS === '1'
}

/** True for this machine: localhost (and *.localhost), loopback addresses, and the any-address. */
export function isLocalHost(host: string | undefined | null, extra: readonly string[] = []): boolean {
  if (!host) return true // no host means a local default
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    LOCAL_HOSTS.has(h) ||
    extra.includes(h) ||
    h.endsWith('.localhost') ||
    /^127\.\d+\.\d+\.\d+$/.test(h) ||
    h.startsWith('::ffff:127.')
  )
}

/** Host of an http(s)/ws(s) URL that leaves this machine, else undefined. */
export function remoteHostOf(url: string, base?: string, extra: readonly string[] = []): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url, base)
  } catch {
    return undefined
  }
  if (!/^(https?|wss?):$/.test(parsed.protocol)) return undefined // data:, blob:, file:, ...
  return isLocalHost(parsed.hostname, extra) ? undefined : parsed.hostname
}

/**
 * The EAS indexer (easscan GraphQL) answers every query with no attestations and no schemas, as
 * a chain with nothing on it would. Without this, most SDK tests sent schema lookups to
 * optimism-sepolia.easscan.org on every save. Production queries the real indexer; tests of EAS
 * reads stub `fetch` or the EAS client themselves, which replaces this.
 */
export function emptyEasIndexerResponse(url: string, init?: RequestInit): Response | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (!parsed.hostname.endsWith('easscan.org') || !parsed.pathname.endsWith('/graphql')) return undefined
  let query = ''
  try {
    query = String(JSON.parse(String(init?.body ?? '{}')).query ?? '')
  } catch {
    return undefined
  }
  // Every top-level field the SDK selects is a list (attestations or schemata, usually aliased).
  const data: Record<string, unknown[]> = {}
  for (const match of query.matchAll(/(\w+)\s*:\s*(?:attestations|schemata)\s*\(|[{\s](attestations|schemata)\s*\(/g)) {
    data[match[1] ?? match[2]!] = []
  }
  return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
}

const blocked: string[] = []

/** Records a blocked request and returns the error to throw for it. */
export function blockRequest(what: string): Error {
  const stack = new Error().stack?.split('\n').slice(3, 9).join('\n') ?? ''
  blocked.push(`${what}\n${stack}`)
  return new Error(
    `No network in tests: ${what}. Mock it at the network boundary, or move the test to a ` +
      '*.live.test.ts that runs only with SEED_LIVE_NETWORK_TESTS=1 (docs/TESTING.md).',
  )
}

/**
 * Throws if any request was blocked since the last call, listing them, so a test whose code
 * caught the error still fails. Called from afterEach/afterAll.
 */
export function assertNoBlockedRequests(when: string): void {
  if (blocked.length === 0) return
  const list = blocked.splice(0)
  throw new Error(
    `${list.length} network request(s) blocked ${when} (no network in tests; see docs/TESTING.md):\n\n` +
      list.join('\n\n'),
  )
}

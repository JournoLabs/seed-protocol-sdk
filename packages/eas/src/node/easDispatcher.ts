import type { Dispatcher } from 'undici'

/**
 * TLS key-exchange groups offered to EAS indexers. Node 24.21+ (OpenSSL 3.5) also offers the
 * post-quantum X25519MLKEM768 by default; easscan doesn't support it, and with it in the
 * ClientHello each new connection's handshake took about 1.45 s instead of about 175 ms.
 */
export const EAS_NODE_ECDH_CURVE = 'X25519:P-256'

/**
 * How long an idle connection to the indexer is kept for reuse. Node's fetch closes idle sockets
 * after 4 s, so a read after a short pause opened (and handshook) new connections.
 */
export const EAS_NODE_KEEP_ALIVE_TIMEOUT_MS = 30_000

export type EasNodeDispatcherOptions = {
  /** `ecdhCurve` for the TLS connection. Default {@link EAS_NODE_ECDH_CURVE}. */
  ecdhCurve?: string
  /** Idle connection lifetime. Default {@link EAS_NODE_KEEP_ALIVE_TIMEOUT_MS}. */
  keepAliveTimeoutMs?: number
}

/** Where undici keeps fetch's global dispatcher: `.2` from undici 7.x, `.1` in Node 20/22's undici 6. */
const GLOBAL_DISPATCHER_KEYS = [Symbol.for('undici.globalDispatcher.2'), Symbol.for('undici.globalDispatcher.1')]

/**
 * True when the host replaced fetch's global dispatcher with something other than a plain
 * `Agent`: a proxy (`ProxyAgent`, `EnvHttpProxyAgent`, which `NODE_USE_ENV_PROXY` installs) or
 * a `MockAgent`. EAS requests then keep going through it.
 */
function hostSetGlobalDispatcher(): boolean {
  const g = globalThis as Record<symbol, unknown>
  const current = GLOBAL_DISPATCHER_KEYS.map((key) => g[key]).find((d) => d != null)
  return current != null && (current as object).constructor?.name !== 'Agent'
}

/**
 * An undici `Agent` for EAS requests only; the process's TLS defaults and fetch's global
 * dispatcher are left alone. Returns undefined outside Node (Bun, Deno), whose fetch has its
 * own connection handling, and undici is then not loaded. Also undefined when the host set a
 * proxy or mock as fetch's global dispatcher, so EAS requests don't bypass it.
 */
export function createEasNodeDispatcher({
  ecdhCurve = EAS_NODE_ECDH_CURVE,
  keepAliveTimeoutMs = EAS_NODE_KEEP_ALIVE_TIMEOUT_MS,
}: EasNodeDispatcherOptions = {}): Dispatcher | undefined {
  const versions = typeof process === 'undefined' ? undefined : (process.versions as Record<string, string | undefined>)
  if (!versions?.node || versions.bun || versions.deno) return undefined
  if (hostSetGlobalDispatcher()) return undefined
  // The Agent module alone: undici's index installs a global dispatcher when none is set yet,
  // which would move every other fetch in the process onto this copy of undici.
  // getBuiltinModule rather than a static `node:module` import keeps this entry loadable in a
  // browser (some browser tests import NodeQueryClient from it).
  const { createRequire } = process.getBuiltinModule('node:module') as typeof import('node:module')
  const Agent = createRequire(import.meta.url)('undici/lib/dispatcher/agent.js') as typeof import('undici').Agent
  return new Agent({ connect: { ecdhCurve }, keepAliveTimeout: keepAliveTimeoutMs })
}

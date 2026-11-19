import { parseArgs } from 'node:util'
import type { SeedMcpServerOptions } from './server.js'

export const USAGE = `Usage: seed-mcp [--attester <address>]... [--http [options]]

Runs an MCP server with read-only tools over published Seed Protocol content: on stdin and stdout,
or with --http, over Streamable HTTP at /mcp.

  --attester <address>       A publisher whose seeds the server reads. Repeat for several. Seeds
                             attested by anyone else are refused. Also read from SEED_MCP_ATTESTERS,
                             comma-separated. With none, list_seeds needs an attester from the caller.
  --http                     Serve over HTTP instead of stdio.
  --port <n>                 HTTP port. Default 3000.
  --host <address>           Address to listen on. Default 127.0.0.1.
  --allowed-origin <origin>  A browser origin allowed to call. Repeat for several. Requests from any
                             other Origin get 403; requests with no Origin header are accepted.
  --rate-limit <n>           Requests per minute per client address. Default 120; 0 turns it off.
  --trust-proxy              Take the client address from the last X-Forwarded-For entry. Set it
                             only behind a proxy that adds that header.
  -h, --help                 Print this and exit.

EAS_CHAIN_ID and EAS_ENDPOINT choose the chain and indexer (default: OP Sepolia's EAS indexer).
ARWEAVE_HOST chooses the gateway item bodies are read from. CACHE_DIR, CACHE_TTL and CACHE_ENABLED
configure the on-disk cache of reads (default ./cache, one hour).`

export interface HttpCliOptions {
  readonly port: number
  readonly host: string
  readonly allowedOrigins: readonly string[]
  readonly rateLimit: number
  readonly trustProxy: boolean
}

export type CliResult =
  | { readonly kind: 'run'; readonly options: SeedMcpServerOptions; readonly http?: HttpCliOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

function wholeNumber(name: string, value: string | undefined, fallback: number, max: number): number | string {
  if (value === undefined) return fallback
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 && n <= max ? n : `--${name} must be a whole number from 0 to ${max}, got ${value}`
}

/** The server options `args` (without the program name) and `env` give, or why they're wrong. */
export function parseCli(args: readonly string[], env: Record<string, string | undefined>): CliResult {
  let values: {
    attester?: string[]
    help?: boolean
    http?: boolean
    port?: string
    host?: string
    'allowed-origin'?: string[]
    'rate-limit'?: string
    'trust-proxy'?: boolean
  }
  try {
    ;({ values } = parseArgs({
      args: [...args],
      options: {
        attester: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
        http: { type: 'boolean' },
        port: { type: 'string' },
        host: { type: 'string' },
        'allowed-origin': { type: 'string', multiple: true },
        'rate-limit': { type: 'string' },
        'trust-proxy': { type: 'boolean' },
      },
    }))
  } catch (error) {
    return { kind: 'error', message: (error as Error).message }
  }
  if (values.help) return { kind: 'help' }

  const fromEnv = (env.SEED_MCP_ATTESTERS ?? '').split(',').map((a) => a.trim()).filter(Boolean)
  const attesters = [...new Set([...(values.attester ?? []), ...fromEnv].map((a) => a.toLowerCase()))]
  const bad = attesters.find((a) => !ADDRESS.test(a))
  if (bad) return { kind: 'error', message: `Not a 20-byte hex address: ${bad}` }

  const httpOnly = ['port', 'host', 'allowed-origin', 'rate-limit', 'trust-proxy'] as const
  if (!values.http) {
    const stray = httpOnly.find((name) => values[name] !== undefined)
    if (stray) return { kind: 'error', message: `--${stray} needs --http` }
    return { kind: 'run', options: { attesters } }
  }

  const port = wholeNumber('port', values.port, 3000, 65_535)
  if (typeof port === 'string') return { kind: 'error', message: port }
  const rateLimit = wholeNumber('rate-limit', values['rate-limit'], 120, 1_000_000)
  if (typeof rateLimit === 'string') return { kind: 'error', message: rateLimit }
  const allowedOrigins = values['allowed-origin'] ?? []
  const badOrigin = allowedOrigins.find((o) => {
    try {
      return new URL(o).origin !== o
    } catch {
      return true
    }
  })
  if (badOrigin) return { kind: 'error', message: `Not an origin (scheme://host[:port]): ${badOrigin}` }

  return {
    kind: 'run',
    options: { attesters },
    http: { port, host: values.host ?? '127.0.0.1', allowedOrigins, rateLimit, trustProxy: values['trust-proxy'] ?? false },
  }
}

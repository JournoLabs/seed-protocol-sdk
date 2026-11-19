import { parseArgs } from 'node:util'
import type { SeedMcpServerOptions } from './server.js'

export const USAGE = `Usage: seed-mcp [--attester <address>]...

Runs an MCP server on stdin and stdout with read-only tools over published Seed Protocol content.

  --attester <address>  A publisher whose seeds the server reads. Repeat for several. Seeds
                        attested by anyone else are refused. Also read from SEED_MCP_ATTESTERS,
                        comma-separated. With none, list_seeds needs an attester from the caller.
  -h, --help            Print this and exit.

EAS_CHAIN_ID and EAS_ENDPOINT choose the chain and indexer (default: OP Sepolia's EAS indexer).
ARWEAVE_HOST chooses the gateway item bodies are read from.`

export type CliResult =
  | { readonly kind: 'run'; readonly options: SeedMcpServerOptions }
  | { readonly kind: 'help' }
  | { readonly kind: 'error'; readonly message: string }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** The server options `args` (without the program name) and `env` give, or why they're wrong. */
export function parseCli(args: readonly string[], env: Record<string, string | undefined>): CliResult {
  let values: { attester?: string[]; help?: boolean }
  try {
    ;({ values } = parseArgs({
      args: [...args],
      options: {
        attester: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
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
  return { kind: 'run', options: { attesters } }
}

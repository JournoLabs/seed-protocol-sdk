/**
 * `seed-gateway serve|connect`, run by `bin.ts`. Separate so tests can call `main`.
 */
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { connectTunnel, loadOrCreateOperatorKeypair, serveTunnel } from './index'

const DEFAULT_OPERATOR_KEY_FILE = path.join('.seed', 'gateway-tunnel', 'operator.key.json')

const USAGE = `Usage:
  seed-gateway serve [--upstream http://127.0.0.1:80] [--key-file <path>] [--upstream-timeout-ms 30000]
      Operator: accept Hyper connections and proxy them to a local upstream (Traefik).
      Default --key-file: ./.seed/gateway-tunnel/operator.key.json (created on first run).
      Answers 504 when the upstream is idle for --upstream-timeout-ms (0 disables).

  seed-gateway connect <key> [--host 127.0.0.1] [--port 1984] [--request-timeout-ms 60000]
                       [--key-file <path>]
      Client: dial an operator key and expose a localhost HTTP sidecar.
      Abandons a request and reconnects when the tunnel is idle for --request-timeout-ms.
      [--max-streams 4] opens up to that many streams to the operator, one request each.
      --key-file keeps this client's key in a file (created on first run), so the operator
      can list it with --allow-keys. Without it, each run uses a new key.

  seed-gateway connect --print-key --key-file <path>
      Print the client public key (z32) in the key file, creating the file if missing.`

function fail(message: string): never {
  console.error(`[Seed Protocol] ${message}`)
  console.error(USAGE)
  process.exit(1)
}

function parseMs(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const ms = Number(value)
  if (!Number.isInteger(ms) || ms < 0) fail(`${flag} must be a whole number of milliseconds`)
  return ms
}

function parseCount(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1) fail(`${flag} must be a whole number of at least 1`)
  return count
}

function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onStop = () => {
      process.off('SIGINT', onStop)
      process.off('SIGTERM', onStop)
      resolve()
    }
    process.on('SIGINT', onStop)
    process.on('SIGTERM', onStop)
  })
}

export async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE)
    return
  }

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      upstream: { type: 'string', default: 'http://127.0.0.1:80' },
      // No default here: serve and connect default differently.
      'key-file': { type: 'string' },
      'print-key': { type: 'boolean', default: false },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '1984' },
      'upstream-timeout-ms': { type: 'string' },
      'request-timeout-ms': { type: 'string' },
      'max-streams': { type: 'string' },
    },
  })

  if (command === 'serve') {
    const upstream = values.upstream.trim()
    const keyFile = path.resolve(values['key-file'] ?? DEFAULT_OPERATOR_KEY_FILE)
    console.log(`[Seed Protocol] Gateway tunnel upstream: ${upstream}`)
    console.log(`[Seed Protocol] Operator key file: ${keyFile}`)

    const session = await serveTunnel({
      upstream,
      keyFile,
      upstreamTimeoutMs: parseMs(values['upstream-timeout-ms'], '--upstream-timeout-ms'),
    })
    console.log(`[Seed Protocol] Operator key (z32): ${session.key}`)
    console.log('[Seed Protocol] Share this key with SDK users (gatewayHyperKey).')
    console.log('[Seed Protocol] Press Ctrl+C to stop.')
    await waitForSignal()
    await session.close()
    console.log('[Seed Protocol] Gateway tunnel stopped.')
    return
  }

  if (command === 'connect') {
    const keyFile = values['key-file'] ? path.resolve(values['key-file']) : undefined
    if (values['print-key']) {
      if (!keyFile) fail('--print-key requires --key-file')
      console.log(loadOrCreateOperatorKeypair(keyFile).z32)
      return
    }

    const key = positionals[0]
    if (!key) fail('seed-gateway connect requires an operator public key (z32 or hex)')

    console.log(`[Seed Protocol] Connecting to operator ${key}`)
    const session = await connectTunnel({
      key,
      keyFile,
      host: values.host,
      port: parseInt(values.port, 10) || 1984,
      requestTimeoutMs: parseMs(values['request-timeout-ms'], '--request-timeout-ms'),
      maxStreams: parseCount(values['max-streams'], '--max-streams'),
    })
    console.log(
      `[Seed Protocol] Client key (z32): ${session.clientKey}${keyFile ? '' : ' (new for this run)'}`,
    )
    console.log(`[Seed Protocol] Local sidecar: ${session.baseUrl}`)
    console.log(
      '[Seed Protocol] Point SDK transport=hyper or hybrid at this URL (default sidecar port 1984).',
    )
    console.log('[Seed Protocol] Press Ctrl+C to stop.')
    await waitForSignal()
    await session.close()
    console.log('[Seed Protocol] Gateway sidecar stopped.')
    return
  }

  fail(`Unknown command: ${command}`)
}

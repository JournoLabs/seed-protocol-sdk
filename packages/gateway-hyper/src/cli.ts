/**
 * `seed-gateway serve|connect`, run by `bin.ts`. Separate so tests can call `main`.
 */
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import {
  connectRawTunnel,
  connectTunnel,
  createAllowlist,
  DEFAULT_RAW_OPERATOR_KEY_FILE,
  DEFAULT_RAW_PORT,
  loadOrCreateOperatorKeypair,
  serveRawTunnel,
  serveTunnel,
  type RawClientEvent,
  type RawTunnelEvent,
  type TunnelEvent,
} from './index'

const DEFAULT_OPERATOR_KEY_FILE = path.join('.seed', 'gateway-tunnel', 'operator.key.json')
const DEFAULT_PORT = 1984

const USAGE = `Usage:
  seed-gateway serve [--upstream http://127.0.0.1:80] [--key-file <path>] [--upstream-timeout-ms 30000]
                     [--allow-keys k1,k2] [--allow-ips 192.168.1.0/24,203.0.113.7]
      Operator: accept Hyper connections and proxy them to a local upstream (Traefik).
      Default --key-file: ./.seed/gateway-tunnel/operator.key.json (created on first run).
      Answers 504 when the upstream is idle for --upstream-timeout-ms (0 disables).
      With --allow-keys or --allow-ips, only clients whose public key or address is listed
      can connect. A client on the operator's LAN shows its LAN address.
      --trace logs each stream and request event as a \`tunnel-trace <event> key=value\` line.
      --request-id-header <name> sends each request's id upstream under that header.

  seed-gateway connect <key> [--host 127.0.0.1] [--port 1984] [--request-timeout-ms 60000]
                       [--connect-timeout-ms 30000] [--key-file <path>]
      Client: dial an operator key and expose a localhost HTTP sidecar.
      Abandons a request and reconnects when the tunnel is idle for --request-timeout-ms.
      [--max-streams 4] opens up to that many streams to the operator, one request each.
      --key-file keeps this client's key in a file (created on first run), so the operator
      can list it with --allow-keys. Without it, each run uses a new key.

  seed-gateway connect --print-key --key-file <path>
      Print the client public key (z32) in the key file, creating the file if missing.

  seed-gateway serve --raw [--upstream http://127.0.0.1:80] [--key-file <path>]
                           [--allow-keys ...] [--allow-ips ...] [--trace]
      Operator, raw mode: pipe each Hyper connection byte for byte to a new TCP connection to
      the upstream, so HTTP runs end to end with no size limit, streaming and WebSockets.
      Default --key-file: ./${DEFAULT_RAW_OPERATOR_KEY_FILE}. Raw and framed servers need
      separate keys; clients of one can't talk to the other.

  seed-gateway connect --raw <key> [--host 127.0.0.1] [--port ${DEFAULT_RAW_PORT}] [--key-file <path>]
                                   [--max-connections 64] [--connect-timeout-ms 30000] [--trace]
      Client, raw mode: listen on a local TCP port and carry each connection to a raw operator
      over its own Hyper stream. Put a client that keeps connections alive (nginx with
      keepalive) in front; each new connection costs a DHT lookup and handshake.`

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

/** One `tunnel-trace` line per event: ISO time, event name, then `key=value` fields. */
export function formatTunnelEvent(
  event: TunnelEvent | RawTunnelEvent | RawClientEvent,
  now = new Date(),
): string {
  const parts = [now.toISOString(), 'tunnel-trace', event.name]
  for (const [key, value] of Object.entries(event)) {
    if (key === 'name' || value === undefined || value === null) continue
    const text = String(value)
    parts.push(`${key}=${/[\s"=]/.test(text) ? JSON.stringify(text) : text}`)
  }
  return parts.join(' ')
}

function logTunnelEvent(event: TunnelEvent | RawTunnelEvent | RawClientEvent): void {
  console.log(formatTunnelEvent(event))
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('--port must be 0–65535')
  return port
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
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
      // No default here: framed and raw connect default differently.
      port: { type: 'string' },
      raw: { type: 'boolean', default: false },
      'max-connections': { type: 'string' },
      'connect-timeout-ms': { type: 'string' },
      'upstream-timeout-ms': { type: 'string' },
      'request-timeout-ms': { type: 'string' },
      'max-streams': { type: 'string' },
      'allow-keys': { type: 'string' },
      'allow-ips': { type: 'string' },
      trace: { type: 'boolean', default: false },
      'request-id-header': { type: 'string' },
    },
  })

  if (command === 'serve' && values.raw) {
    const upstream = values.upstream.trim()
    const keyFile = path.resolve(values['key-file'] ?? DEFAULT_RAW_OPERATOR_KEY_FILE)
    console.log(`[Seed Protocol] Raw tunnel upstream: ${upstream}`)
    console.log(`[Seed Protocol] Raw operator key file: ${keyFile}`)
    const allowlist = { keys: splitList(values['allow-keys']), ips: splitList(values['allow-ips']) }
    console.log(`[Seed Protocol] Allowlist: ${createAllowlist(allowlist).summary}`)

    const session = await serveRawTunnel({
      upstream,
      keyFile,
      allowlist,
      onEvent: values.trace ? logTunnelEvent : undefined,
    })
    console.log(`[Seed Protocol] Raw operator key (z32): ${session.key}`)
    console.log('[Seed Protocol] Clients connect with: seed-gateway connect --raw <key>')
    console.log('[Seed Protocol] Press Ctrl+C to stop.')
    await waitForSignal()
    await session.close()
    console.log('[Seed Protocol] Raw tunnel stopped.')
    return
  }

  if (command === 'serve') {
    const upstream = values.upstream.trim()
    const keyFile = path.resolve(values['key-file'] ?? DEFAULT_OPERATOR_KEY_FILE)
    console.log(`[Seed Protocol] Gateway tunnel upstream: ${upstream}`)
    console.log(`[Seed Protocol] Operator key file: ${keyFile}`)
    const allowlist = { keys: splitList(values['allow-keys']), ips: splitList(values['allow-ips']) }
    console.log(`[Seed Protocol] Allowlist: ${createAllowlist(allowlist).summary}`)

    const session = await serveTunnel({
      upstream,
      keyFile,
      allowlist,
      onEvent: values.trace ? logTunnelEvent : undefined,
      requestIdHeader: values['request-id-header']?.trim() || undefined,
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
    const connectTimeoutMs = parseMs(values['connect-timeout-ms'], '--connect-timeout-ms')

    if (values.raw) {
      console.log(`[Seed Protocol] Connecting to raw operator ${key}`)
      const session = await connectRawTunnel({
        key,
        keyFile,
        host: values.host,
        port: parsePort(values.port, DEFAULT_RAW_PORT),
        maxConnections: parseCount(values['max-connections'], '--max-connections'),
        connectTimeoutMs,
        onEvent: values.trace ? logTunnelEvent : undefined,
      })
      console.log(
        `[Seed Protocol] Client key (z32): ${session.clientKey}${keyFile ? '' : ' (new for this run)'}`,
      )
      console.log(`[Seed Protocol] Raw tunnel listening on ${session.host}:${session.port}`)
      console.log('[Seed Protocol] Press Ctrl+C to stop.')
      await waitForSignal()
      await session.close()
      console.log('[Seed Protocol] Raw tunnel client stopped.')
      return
    }

    console.log(`[Seed Protocol] Connecting to operator ${key}`)
    const session = await connectTunnel({
      key,
      keyFile,
      host: values.host,
      port: parsePort(values.port, DEFAULT_PORT),
      connectTimeoutMs,
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

/**
 * `seed-gateway serve|connect` — HTTP tunnel to Seed gateway + upload API infrastructure over HyperDHT.
 * Run under Node (Holepunch natives may crash under Bun).
 */
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { connectTunnel, serveTunnel } from './index'

const USAGE = `Usage:
  seed-gateway serve [--upstream http://127.0.0.1:80] [--key-file <path>]
      Operator: accept Hyper connections and proxy them to a local upstream (Traefik).
      Default --key-file: ./.seed/gateway-tunnel/operator.key.json (created on first run).

  seed-gateway connect <key> [--host 127.0.0.1] [--port 1984]
      Client: dial an operator key and expose a localhost HTTP sidecar.`

function fail(message: string): never {
  console.error(`[Seed Protocol] ${message}`)
  console.error(USAGE)
  process.exit(1)
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

async function main(argv: string[]): Promise<void> {
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
      'key-file': {
        type: 'string',
        default: path.join('.seed', 'gateway-tunnel', 'operator.key.json'),
      },
      host: { type: 'string', default: '127.0.0.1' },
      port: { type: 'string', default: '1984' },
    },
  })

  if (command === 'serve') {
    const upstream = values.upstream.trim()
    const keyFile = path.resolve(values['key-file'])
    console.log(`[Seed Protocol] Gateway tunnel upstream: ${upstream}`)
    console.log(`[Seed Protocol] Operator key file: ${keyFile}`)

    const session = await serveTunnel({ upstream, keyFile })
    console.log(`[Seed Protocol] Operator key (z32): ${session.key}`)
    console.log('[Seed Protocol] Share this key with SDK users (gatewayHyperKey).')
    console.log('[Seed Protocol] Press Ctrl+C to stop.')
    await waitForSignal()
    await session.close()
    console.log('[Seed Protocol] Gateway tunnel stopped.')
    return
  }

  if (command === 'connect') {
    const key = positionals[0]
    if (!key) fail('seed-gateway connect requires an operator public key (z32 or hex)')

    console.log(`[Seed Protocol] Connecting to operator ${key}`)
    const session = await connectTunnel({
      key,
      host: values.host,
      port: parseInt(values.port, 10) || 1984,
    })
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

main(process.argv.slice(2)).catch((err) => {
  console.error('[Seed Protocol]', err instanceof Error ? err.message : err)
  process.exit(1)
})

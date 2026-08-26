import type { Command } from 'commander'
import path from 'path'
import process from 'node:process'

function defaultKeyFile(): string {
  return path.resolve(process.cwd(), '.seed', 'gateway-tunnel', 'operator.key.json')
}

function defaultStorePath(): string {
  return path.resolve(process.cwd(), '.seed', 'gateway-tunnel')
}

async function loadGatewayHyper() {
  try {
    return await import('@seedprotocol/gateway-hyper')
  } catch (err) {
    console.error(
      '[Seed Protocol] @seedprotocol/gateway-hyper is required for gateway commands.',
    )
    console.error(
      '[Seed Protocol] Install it in this workspace / project, and ensure native Holepunch deps build successfully.',
    )
    console.error(err)
    process.exit(1)
  }
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

/**
 * Register `seed gateway tunnel serve|connect` on the root Commander program.
 */
export function registerGatewayCommands(program: Command): void {
  const gateway = program
    .command('gateway')
    .description('Tunnel Seed gateway + upload API over HyperDHT')

  const tunnel = gateway
    .command('tunnel')
    .description('HTTP tunnel to operator infrastructure')

  tunnel
    .command('serve')
    .description('Operator: accept Hyper connections and proxy to local upstream (Traefik)')
    .option('--upstream <url>', 'Upstream HTTP origin', 'http://127.0.0.1:80')
    .option('--key-file <path>', 'Operator keypair JSON path', defaultKeyFile())
    .option('--store <path>', 'Reserved for future DHT persistence', defaultStorePath())
    .action(async (opts) => {
      const hyper = await loadGatewayHyper()
      const upstream = String(opts.upstream).trim()
      const keyFile = path.resolve(String(opts.keyFile))

      console.log(`[Seed Protocol] Gateway tunnel upstream: ${upstream}`)
      console.log(`[Seed Protocol] Operator key file: ${keyFile}`)

      const session = await hyper.serveTunnel({
        upstream,
        keyFile,
        storePath: path.resolve(String(opts.store)),
      })

      console.log(`[Seed Protocol] Operator key (z32): ${session.key}`)
      console.log('[Seed Protocol] Share this key with SDK users (gatewayHyperKey).')
      console.log('[Seed Protocol] Press Ctrl+C to stop.')

      await waitForSignal()
      await session.close()
      console.log('[Seed Protocol] Gateway tunnel stopped.')
    })

  tunnel
    .command('connect')
    .description('Client: dial operator key and expose localhost HTTP sidecar')
    .argument('<key>', 'Operator public key (z32 or hex)')
    .option('--host <host>', 'Local HTTP bind host', '127.0.0.1')
    .option('--port <n>', 'Local HTTP bind port', '1984')
    .option('--store <path>', 'Reserved for future DHT persistence', defaultStorePath())
    .action(async (key: string, opts) => {
      const hyper = await loadGatewayHyper()
      const host = String(opts.host)
      const port = parseInt(String(opts.port), 10) || 1984

      console.log(`[Seed Protocol] Connecting to operator ${key}`)
      const session = await hyper.connectTunnel({
        key,
        host,
        port,
        storePath: path.resolve(String(opts.store)),
      })

      console.log(`[Seed Protocol] Local sidecar: ${session.baseUrl}`)
      console.log(
        '[Seed Protocol] Point SDK transport=hyper or hybrid at this URL (default sidecar port 1984).',
      )
      console.log('[Seed Protocol] Press Ctrl+C to stop.')

      await waitForSignal()
      await session.close()
      console.log('[Seed Protocol] Gateway sidecar stopped.')
    })
}

import type { Command } from 'commander'
import type { FeedFormat } from '@seedprotocol/feed'
import path from 'path'
import process from 'node:process'

function parseFormats(raw: string): FeedFormat[] {
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const allowed: FeedFormat[] = ['rss', 'atom', 'json']
  const formats = parts.filter((p): p is FeedFormat =>
    (allowed as string[]).includes(p),
  )
  if (!formats.length) {
    throw new Error(`Invalid --format (expected rss,atom,json): ${raw}`)
  }
  return formats
}

function parseSchemas(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(',')
  const schemas = list.map((s) => s.trim()).filter(Boolean)
  if (!schemas.length) {
    throw new Error('At least one --schema is required')
  }
  return schemas
}

function defaultStorePath(): string {
  return path.resolve(process.cwd(), '.seed', 'feed-store')
}

async function loadHyper() {
  try {
    return await import('@seedprotocol/feed-hyper')
  } catch (err) {
    console.error(
      '[Seed Protocol] @seedprotocol/feed-hyper is required for feed commands.',
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
 * Register `seed feed publish|seed|serve` on the root Commander program.
 */
export function registerFeedCommands(program: Command): void {
  const feed = program
    .command('feed')
    .description('Publish, seed, and serve Seed feeds over Hyperdrive / Hyperswarm')

  feed
    .command('publish')
    .description('Generate feeds and write them into a Hyperdrive')
    .requiredOption(
      '--schema <names>',
      'Comma-separated schema names (e.g. post or post,identity)',
    )
    .option(
      '--format <formats>',
      'Comma-separated formats: rss,atom,json',
      'rss,atom,json',
    )
    .option(
      '--store <path>',
      'Corestore directory',
      defaultStorePath(),
    )
    .option('--drive-name <name>', 'Named drive for writable publish', 'seed-feed')
    .option('--page-size <n>', 'Items per feed page', '25')
    .option('--no-announce', 'Write drive then exit without joining Hyperswarm')
    .option('--site-url <url>', 'Override channel site URL')
    .action(async (opts) => {
      const hyper = await loadHyper()
      const schemas = parseSchemas(opts.schema)
      const formats = parseFormats(opts.format)
      const storePath = path.resolve(opts.store)
      const pageSize = parseInt(opts.pageSize, 10) || 25
      const announce = opts.announce !== false

      console.log(`[Seed Protocol] Publishing feeds for schemas: ${schemas.join(', ')}`)
      console.log(`[Seed Protocol] Formats: ${formats.join(', ')}`)
      console.log(`[Seed Protocol] Store: ${storePath}`)

      const session = await hyper.publishFeed({
        schemas,
        formats,
        storePath,
        driveName: opts.driveName,
        pageSize,
        announce,
        siteUrl: opts.siteUrl,
      })

      console.log(`[Seed Protocol] Drive key (z32): ${session.key}`)
      console.log(`[Seed Protocol] hyper URL: ${session.hyperUrl}`)
      console.log(`[Seed Protocol] Version: ${session.version}`)
      console.log('[Seed Protocol] Paths:')
      for (const p of session.paths) {
        console.log(`  ${p}`)
      }

      if (announce) {
        console.log(
          '[Seed Protocol] Announcing on Hyperswarm. Press Ctrl+C to stop.',
        )
        await waitForSignal()
        await session.close()
        console.log('[Seed Protocol] Publisher stopped.')
      }
    })

  feed
    .command('seed')
    .description('Replicate a feed Hyperdrive (no generation)')
    .argument('<key>', 'Hyperdrive public key (z32 or hex)')
    .option('--store <path>', 'Corestore directory', defaultStorePath())
    .action(async (key: string, opts) => {
      const hyper = await loadHyper()
      const storePath = path.resolve(opts.store)
      console.log(`[Seed Protocol] Seeding feed ${key}`)
      console.log(`[Seed Protocol] Store: ${storePath}`)
      const session = await hyper.seedFeed({ key, storePath })
      console.log(`[Seed Protocol] Seeding ${session.key}. Press Ctrl+C to stop.`)
      await waitForSignal()
      await session.close()
      console.log('[Seed Protocol] Seeder stopped.')
    })

  feed
    .command('serve')
    .description('Seed a feed and expose it over localhost HTTP for RSS readers')
    .argument('<key>', 'Hyperdrive public key (z32 or hex)')
    .option('--store <path>', 'Corestore directory', defaultStorePath())
    .option('--port <n>', 'HTTP port', '8080')
    .option('--host <host>', 'HTTP bind host', '127.0.0.1')
    .option('--no-announce', 'Serve from local store without joining Hyperswarm')
    .action(async (key: string, opts) => {
      const hyper = await loadHyper()
      const storePath = path.resolve(opts.store)
      const port = parseInt(opts.port, 10) || 8080
      const host = opts.host as string
      const announce = opts.announce !== false

      console.log(`[Seed Protocol] Serving feed ${key}`)
      const session = await hyper.serveFeed({
        key,
        storePath,
        port,
        host,
        announce,
      })

      const example = hyper.localFeedUrl(session.baseUrl, 'post', 'rss')
      console.log(`[Seed Protocol] HTTP gateway: ${session.baseUrl}`)
      console.log(`[Seed Protocol] Example RSS URL: ${example}`)
      console.log('[Seed Protocol] Press Ctrl+C to stop.')
      await waitForSignal()
      await session.close()
      console.log('[Seed Protocol] Serve stopped.')
    })
}

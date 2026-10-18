/**
 * `seed-feed publish|seed|serve` — operator CLI for Seed feeds over Hyperdrive / Hyperswarm.
 * Run under Node (Holepunch natives may crash under Bun).
 */
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import type { FeedFormat } from '@seedprotocol/feed'
import { localFeedUrl, publishFeed, seedFeed, serveFeed } from './index'

const USAGE = `Usage:
  seed-feed publish --schema <names> [--format rss,atom,json] [--store <path>]
                    [--drive-name <name>] [--page-size <n>] [--site-url <url>] [--no-announce]
      Generate feeds and write them into a Hyperdrive, then announce on Hyperswarm.

  seed-feed seed <key> [--store <path>]
      Replicate a feed Hyperdrive (no generation).

  seed-feed serve <key> [--store <path>] [--port 8080] [--host 127.0.0.1] [--no-announce]
      Seed a feed and expose it over localhost HTTP for RSS readers.

Default --store: ./.seed/feed-store`

function fail(message: string): never {
  console.error(`[Seed Protocol] ${message}`)
  console.error(USAGE)
  process.exit(1)
}

function parseFormats(raw: string): FeedFormat[] {
  const allowed: FeedFormat[] = ['rss', 'atom', 'json']
  const formats = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((p): p is FeedFormat => (allowed as string[]).includes(p))
  if (!formats.length) fail(`Invalid --format (expected rss,atom,json): ${raw}`)
  return formats
}

function parseSchemas(raw: string | undefined): string[] {
  const schemas = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!schemas.length) fail('At least one --schema is required')
  return schemas
}

function parseIntOr(raw: string, fallback: number): number {
  return parseInt(raw, 10) || fallback
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
      schema: { type: 'string' },
      format: { type: 'string', default: 'rss,atom,json' },
      store: { type: 'string', default: path.join('.seed', 'feed-store') },
      'drive-name': { type: 'string', default: 'seed-feed' },
      'page-size': { type: 'string', default: '25' },
      'site-url': { type: 'string' },
      port: { type: 'string', default: '8080' },
      host: { type: 'string', default: '127.0.0.1' },
      'no-announce': { type: 'boolean', default: false },
    },
  })
  const storePath = path.resolve(values.store)
  const announce = !values['no-announce']

  if (command === 'publish') {
    const schemas = parseSchemas(values.schema)
    const formats = parseFormats(values.format)
    console.log(`[Seed Protocol] Publishing feeds for schemas: ${schemas.join(', ')}`)
    console.log(`[Seed Protocol] Formats: ${formats.join(', ')}`)
    console.log(`[Seed Protocol] Store: ${storePath}`)

    const session = await publishFeed({
      schemas,
      formats,
      storePath,
      driveName: values['drive-name'],
      pageSize: parseIntOr(values['page-size'], 25),
      announce,
      siteUrl: values['site-url'],
    })

    console.log(`[Seed Protocol] Drive key (z32): ${session.key}`)
    console.log(`[Seed Protocol] hyper URL: ${session.hyperUrl}`)
    console.log(`[Seed Protocol] Version: ${session.version}`)
    console.log('[Seed Protocol] Paths:')
    for (const p of session.paths) console.log(`  ${p}`)

    if (announce) {
      console.log('[Seed Protocol] Announcing on Hyperswarm. Press Ctrl+C to stop.')
      await waitForSignal()
      await session.close()
      console.log('[Seed Protocol] Publisher stopped.')
    } else {
      await session.close()
    }
    return
  }

  if (command === 'seed' || command === 'serve') {
    const key = positionals[0]
    if (!key) fail(`seed-feed ${command} requires a Hyperdrive key (z32 or hex)`)

    if (command === 'seed') {
      console.log(`[Seed Protocol] Seeding feed ${key}`)
      console.log(`[Seed Protocol] Store: ${storePath}`)
      const session = await seedFeed({ key, storePath })
      console.log(`[Seed Protocol] Seeding ${session.key}. Press Ctrl+C to stop.`)
      await waitForSignal()
      await session.close()
      console.log('[Seed Protocol] Seeder stopped.')
      return
    }

    console.log(`[Seed Protocol] Serving feed ${key}`)
    const session = await serveFeed({
      key,
      storePath,
      port: parseIntOr(values.port, 8080),
      host: values.host,
      announce,
    })
    console.log(`[Seed Protocol] HTTP gateway: ${session.baseUrl}`)
    console.log(`[Seed Protocol] Example RSS URL: ${localFeedUrl(session.baseUrl, 'post', 'rss')}`)
    console.log('[Seed Protocol] Press Ctrl+C to stop.')
    await waitForSignal()
    await session.close()
    console.log('[Seed Protocol] Serve stopped.')
    return
  }

  fail(`Unknown command: ${command}`)
}

main(process.argv.slice(2)).catch((err) => {
  console.error('[Seed Protocol]', err instanceof Error ? err.message : err)
  process.exit(1)
})

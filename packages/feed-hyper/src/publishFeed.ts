import {
  createFeed,
  getFeedItemsBySchemaName,
  type GraphQLItem,
} from '@seedprotocol/feed'
import {
  REGISTRY_PATH,
  feedDrivePath,
  feedHttpPath,
  hyperFeedUrl,
} from './paths'
import { closeFeedStore, encodeKey, openFeedStore, type FeedStoreHandles } from './store'
import type { FeedRegistry, PublishFeedOptions, PublishFeedResult } from './types'

const DEFAULT_SITE_URL = 'https://seedprotocol.io'
const DEFAULT_FEED_TITLE = 'Seed Protocol'

async function resolveSiteDefaults(overrides?: {
  siteUrl?: string
  title?: string
}): Promise<{ siteUrl: string; title: string }> {
  try {
    const feed = await import('@seedprotocol/feed')
    const cfg =
      typeof feed.getSiteConfig === 'function' ? feed.getSiteConfig() : null
    return {
      siteUrl: overrides?.siteUrl ?? cfg?.siteUrl ?? DEFAULT_SITE_URL,
      title: overrides?.title ?? cfg?.title ?? DEFAULT_FEED_TITLE,
    }
  } catch {
    return {
      siteUrl: overrides?.siteUrl ?? DEFAULT_SITE_URL,
      title: overrides?.title ?? DEFAULT_FEED_TITLE,
    }
  }
}

async function putUtf8(
  drive: { put: (path: string, buf: Buffer) => Promise<unknown> },
  path: string,
  content: string,
): Promise<void> {
  await drive.put(path, Buffer.from(content, 'utf-8'))
}

async function writeFeedsToDrive(
  drive: FeedStoreHandles['drive'],
  key: string,
  options: PublishFeedOptions,
): Promise<{ paths: string[]; hyperUrl: string }> {
  const hyperUrl = hyperFeedUrl(key)
  const pageSize = options.pageSize ?? 25
  const paths: string[] = []
  const registrySchemas: FeedRegistry['schemas'] = []

  if (options.fixtureContents) {
    for (const [path, content] of Object.entries(options.fixtureContents)) {
      await putUtf8(drive, path, content)
      paths.push(path)
    }
    registrySchemas.push({
      schema: options.schemas[0]!,
      formats: options.formats,
      paths: [...paths],
    })
  } else {
    const { siteUrl, title } = await resolveSiteDefaults({
      siteUrl: options.siteUrl,
    })
    for (const schema of options.schemas) {
      const schemaPaths: string[] = []
      const items = (await getFeedItemsBySchemaName(schema, {
        limit: pageSize,
        skip: 0,
      })) as GraphQLItem[]
      const hasNext = items.length === pageSize

      for (const format of options.formats) {
        const drivePath = feedDrivePath(schema, format)
        const baseUrl = `${hyperUrl}${feedHttpPath(schema, format)}`
        const content = await createFeed(
          items,
          schema,
          format,
          undefined,
          {
            page: 1,
            pageSize,
            hasNext,
            baseUrl,
          },
          undefined,
          false,
          undefined,
          {
            feedUrl: hyperUrl,
            siteUrl,
            title,
          },
        )
        await putUtf8(drive, drivePath, content)
        paths.push(drivePath)
        schemaPaths.push(drivePath)
      }

      if (options.includeArchives) {
        const now = new Date()
        const year = now.getFullYear()
        const month = now.getMonth() + 1
        for (const format of options.formats) {
          const archivePath = feedDrivePath(schema, format, { year, month })
          const archiveContent = await createFeed(
            items,
            schema,
            format,
            undefined,
            undefined,
            [
              {
                rel: 'current',
                href: `${hyperUrl}${feedHttpPath(schema, format)}`,
              },
            ],
            true,
            undefined,
            { feedUrl: hyperUrl, siteUrl },
          )
          await putUtf8(drive, archivePath, archiveContent)
          paths.push(archivePath)
          schemaPaths.push(archivePath)
        }
      }

      registrySchemas.push({
        schema,
        formats: [...options.formats],
        paths: schemaPaths,
      })
    }
  }

  const registry: FeedRegistry = {
    key,
    version: drive.version,
    updatedAt: new Date().toISOString(),
    schemas: registrySchemas,
  }
  await putUtf8(drive, REGISTRY_PATH, JSON.stringify(registry, null, 2))
  paths.push(REGISTRY_PATH)

  return { paths, hyperUrl }
}

export type PublishFeedSession = PublishFeedResult & {
  /** Close Corestore / Hyperdrive / Hyperswarm. No-op if already closed. */
  close: () => Promise<void>
}

/**
 * Generate feeds via `@seedprotocol/feed` and write them into a Hyperdrive.
 *
 * - `announce: false` — write, close store, return (one-shot).
 * - `announce: true` (default) — write, keep swarm joined until `close()`.
 */
export async function publishFeed(
  options: PublishFeedOptions,
): Promise<PublishFeedSession> {
  if (!options.schemas.length) {
    throw new Error('publishFeed: schemas must be non-empty')
  }
  if (!options.formats.length) {
    throw new Error('publishFeed: formats must be non-empty')
  }

  const announce = options.announce !== false
  const handles = await openFeedStore({
    storePath: options.storePath,
    driveName: options.driveName,
    announce,
  })

  const key = encodeKey(handles.drive.key)
  const { paths, hyperUrl } = await writeFeedsToDrive(handles.drive, key, options)
  const version = handles.drive.version

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await closeFeedStore(handles)
  }

  if (!announce) {
    await close()
  }

  return {
    key,
    version,
    paths,
    hyperUrl,
    close,
  }
}

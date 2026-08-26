import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { publishFeed } from '../src/publishFeed'
import { openFeedStore, closeFeedStore } from '../src/store'
import { openFeed } from '../src/openFeed'
import { serveFeed, localFeedUrl } from '../src/serveFeed'
import { REGISTRY_PATH, feedDrivePath } from '../src/paths'

const temps: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  while (temps.length) {
    const dir = temps.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

const runHyper =
  process.env.FEED_HYPER_TESTS === '1' ||
  (process.env.CI !== 'true' && process.env.FEED_HYPER_TESTS !== '0')

describe.runIf(runHyper)('feed-hyper publish/open/serve (native)', () => {
  it('publishFeed writes fixture contents and registry', async () => {
    const storePath = await tempDir('feed-hyper-pub-')
    const rssPath = feedDrivePath('post', 'rss')
    const session = await publishFeed({
      schemas: ['post'],
      formats: ['rss'],
      storePath,
      announce: false,
      fixtureContents: {
        [rssPath]:
          '<?xml version="1.0"?><rss><channel><title>Test</title></channel></rss>',
      },
    })

    expect(session.key.length).toBeGreaterThan(10)
    expect(session.paths).toContain(rssPath)
    expect(session.paths).toContain(REGISTRY_PATH)
    expect(session.hyperUrl).toBe(`hyper://${session.key}`)

    const handles = await openFeedStore({
      storePath,
      driveName: 'seed-feed',
      announce: false,
    })
    try {
      const raw = await handles.drive.get(rssPath)
      expect(raw).toBeTruthy()
      expect(Buffer.from(raw!).toString('utf-8')).toContain('<title>Test</title>')
      const reg = await handles.drive.get(REGISTRY_PATH)
      expect(reg).toBeTruthy()
      const parsed = JSON.parse(Buffer.from(reg!).toString('utf-8'))
      expect(parsed.key).toBe(session.key)
      expect(parsed.schemas[0].schema).toBe('post')
    } finally {
      await closeFeedStore(handles)
    }
  })

  it('openFeed reads content from an existing store by key', async () => {
    const storePath = await tempDir('feed-hyper-open-')
    const rssPath = feedDrivePath('post', 'rss')

    const pub = await publishFeed({
      schemas: ['post'],
      formats: ['rss'],
      storePath,
      announce: false,
      fixtureContents: {
        [rssPath]: '<rss>ok</rss>',
      },
    })

    const opened = await openFeed({
      key: pub.key,
      storePath,
      announce: false,
      syncTimeoutMs: 0,
    })
    try {
      const body = await opened.get(rssPath)
      expect(body).toBe('<rss>ok</rss>')
      const registry = await opened.getRegistry()
      expect(registry?.key).toBe(pub.key)
      expect(opened.version).toBeGreaterThan(0)
    } finally {
      await opened.close()
    }
  })

  it(
    'serveFeed serves RSS over HTTP for both path shapes',
    async () => {
      const storePath = await tempDir('feed-hyper-serve-')
      const rssPath = feedDrivePath('post', 'rss')
      const session = await publishFeed({
        schemas: ['post'],
        formats: ['rss'],
        storePath,
        announce: false,
        fixtureContents: {
          [rssPath]:
            '<?xml version="1.0"?><rss version="2.0"><channel><title>Served</title></channel></rss>',
        },
      })

      const served = await serveFeed({
        key: session.key,
        storePath,
        port: 19021,
        host: '127.0.0.1',
        announce: false,
      })

      try {
        const withExt = localFeedUrl(served.baseUrl, 'post', 'rss')
        const withoutExt = `${served.baseUrl}/posts/rss`

        for (const url of [withExt, withoutExt]) {
          const res = await fetch(url)
          const text = await res.text()
          expect(
            res.ok,
            `${url} status=${res.status} body=${text.slice(0, 200)}`,
          ).toBe(true)
          expect(text).toContain('<title>Served</title>')
        }
      } finally {
        await served.close()
      }
    },
    15_000,
  )
})

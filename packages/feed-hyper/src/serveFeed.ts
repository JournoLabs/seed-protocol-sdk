import http from 'node:http'
import ServeDrive from 'serve-drive'
import { feedDrivePath, resolveHttpToDrivePath } from './paths'
import { closeFeedStore, encodeKey, openFeedStore } from './store'
import type { ServeFeedOptions, ServeFeedResult } from './types'

/**
 * Rewrite extensionless feed URLs (`/posts/rss`) to drive paths (`/posts/rss.xml`)
 * so serve-drive looks up the real file and gets the correct Content-Type.
 */
function attachFeedPathRewrite(server: http.Server): void {
  server.on('request', (req) => {
    if (!req.url) return
    const q = req.url.indexOf('?')
    const pathname = q === -1 ? req.url : req.url.slice(0, q)
    const query = q === -1 ? '' : req.url.slice(q)
    const resolved = resolveHttpToDrivePath(pathname)
    if (resolved !== pathname) {
      req.url = resolved + query
    }
  })
}

/**
 * Seed a feed drive and expose it over localhost HTTP via serve-drive.
 * Serves both drive paths (`/posts/rss.xml`) and historical HTTP paths (`/posts/rss`).
 */
export async function serveFeed(options: ServeFeedOptions): Promise<ServeFeedResult> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 8080

  const handles = await openFeedStore({
    storePath: options.storePath,
    key: options.key,
    announce: options.announce !== false,
  })

  try {
    await handles.drive.core.update({ wait: false })
  } catch {
    /* ignore */
  }

  const key = encodeKey(handles.drive.key)

  const server = http.createServer()
  // Must register before ServeDrive attaches its handler so rewrite runs first.
  attachFeedPathRewrite(server)

  const serve = new ServeDrive({
    server,
    port,
    host,
    anyPort: port === 0,
    // Local RSS gateways need unauthenticated GETs; enable token for public hosts via env later
    token: false,
    get: async ({ key: requestKey }: { key: Buffer | null; filename: string; version: number }) => {
      if (requestKey && !requestKey.equals(handles.drive.key)) {
        return null
      }
      return handles.drive
    },
  })

  await serve.ready()

  const boundPort =
    typeof serve.address === 'function'
      ? (serve.address()?.port ?? port)
      : port

  const baseUrl = `http://${host}:${boundPort}`

  return {
    key,
    port: boundPort,
    host,
    baseUrl,
    close: async () => {
      if (typeof serve.close === 'function') {
        await serve.close()
      } else if (typeof (serve as { suspend?: () => Promise<void> }).suspend === 'function') {
        await (serve as { suspend: () => Promise<void> }).suspend()
      }
      await closeFeedStore(handles)
    },
  }
}

/** Example local URL for a schema/format after serveFeed (drive path with extension). */
export function localFeedUrl(
  baseUrl: string,
  schemaName: string,
  format: 'rss' | 'atom' | 'json',
): string {
  return `${baseUrl.replace(/\/$/, '')}${feedDrivePath(schemaName, format)}`
}

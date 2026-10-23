import type { BrowserFeature } from '@/helpers/browserSupport'

/**
 * Thrown by client init when the browser file system can't be mounted because OPFS entries are
 * held by another context — usually another tab of the same app, or a worker from a page that
 * was just reloaded. Hosts can check `code === 'OPFS_LOCKED'` and offer "close other tabs / retry".
 */
export class FileSystemLockedError extends Error {
  readonly code = 'OPFS_LOCKED' as const

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
    super(
      `The browser file system is in use by another tab or worker and could not be opened (${detail}). ` +
        `Close other tabs of this app and retry.`,
      { cause },
    )
    this.name = 'FileSystemLockedError'
  }
}

/**
 * Thrown by client init in the browser when the browser lacks file system features the SDK needs,
 * before anything is loaded or stored. `missing` lists them (see checkBrowserSupport). Hosts can
 * check `code === 'BROWSER_UNSUPPORTED'` and ask the user to update the browser.
 */
export class UnsupportedBrowserError extends Error {
  readonly code = 'BROWSER_UNSUPPORTED' as const
  readonly missing: BrowserFeature[]

  constructor(missing: BrowserFeature[]) {
    super(
      `This browser lacks features Seed needs (${missing.join(', ')}). ` +
        `Seed supports Chrome and Edge 102, Firefox 114 and Safari 26 or later.`,
    )
    this.name = 'UnsupportedBrowserError'
    this.missing = missing
  }
}

/**
 * Thrown by client init in the browser when SQLite can't store the database in OPFS. SQLite's OPFS
 * storage needs `SharedArrayBuffer`, which browsers only expose on cross-origin isolated pages
 * (COOP `same-origin` and COEP `require-corp` or `credentialless` response headers). Without it,
 * SQLocal falls back to an in-memory database and every reload would lose the app's data, so init
 * fails instead. Hosts can check `code === 'DB_NOT_PERSISTENT'`.
 *
 * `reason` picks the advice: `'headers'` when the page isn't cross-origin isolated, `'vfs'` when it
 * is and SQLite's OPFS VFS still failed to install inside the database worker.
 */
export class DatabaseNotPersistentError extends Error {
  readonly code = 'DB_NOT_PERSISTENT' as const

  constructor(detail: string, reason: 'headers' | 'vfs' = 'headers') {
    const advice =
      reason === 'vfs'
        ? `The page is cross-origin isolated, but SQLite's OPFS VFS failed to install inside its database worker. ` +
          `SQLite logs the reason to the browser console, on lines starting "OPFS syncer" or "Ignoring inability to install OPFS".`
        : `Serve the app with Cross-Origin-Opener-Policy: same-origin and ` +
          `Cross-Origin-Embedder-Policy: require-corp (or credentialless). ` +
          `@seedprotocol/vite sets these on the Vite dev and preview servers; production hosting has to set them too.`
    super(
      `SQLite can't store the Seed database in the browser's private file system: ${detail}. ${advice}`,
    )
    this.name = 'DatabaseNotPersistentError'
  }
}

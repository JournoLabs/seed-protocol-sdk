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
 * Thrown by client init in the browser when SQLite can't store the database in OPFS. SQLite's OPFS
 * storage needs `SharedArrayBuffer`, which browsers only expose on cross-origin isolated pages
 * (COOP `same-origin` and COEP `require-corp` or `credentialless` response headers). Without it,
 * SQLocal falls back to an in-memory database and every reload would lose the app's data, so init
 * fails instead. Hosts can check `code === 'DB_NOT_PERSISTENT'`.
 */
export class DatabaseNotPersistentError extends Error {
  readonly code = 'DB_NOT_PERSISTENT' as const

  constructor(detail: string) {
    super(
      `SQLite can't store the Seed database in the browser's private file system: ${detail}. ` +
        `Serve the app with Cross-Origin-Opener-Policy: same-origin and ` +
        `Cross-Origin-Embedder-Policy: require-corp (or credentialless). ` +
        `@seedprotocol/vite sets these on the Vite dev and preview servers; production hosting has to set them too.`,
    )
    this.name = 'DatabaseNotPersistentError'
  }
}

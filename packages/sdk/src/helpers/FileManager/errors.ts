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

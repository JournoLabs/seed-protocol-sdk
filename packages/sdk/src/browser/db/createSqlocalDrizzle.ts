import debug from 'debug'

const logger = debug('seedSdk:browser:db:createSqlocalDrizzle')

/** First sqlocal work can include sqlite-wasm fetch; keep this long to avoid false positives. */
export const SQLOCAL_FIRST_QUERY_TIMEOUT_MS = 90_000

const HTTP_MODULE_WORKER_URL = /^https?:/i

export function shouldBlobWrapModuleWorker(
  scriptURL: string | URL,
  options?: WorkerOptions,
): boolean {
  const type = options?.type ?? 'classic'
  if (type !== 'module') return false
  return HTTP_MODULE_WORKER_URL.test(String(scriptURL))
}

export function createBlobModuleWorkerSource(scriptURL: string | URL): string {
  return `import ${JSON.stringify(String(scriptURL))};`
}

export type CreatedSqlocalDrizzle<T> = {
  instance: T
  workerFailed: Promise<never>
}

/**
 * Construct SQLocal while starting its HTTPS module worker from a blob that
 * only imports the bundled worker URL. Some Chrome profiles kill
 * `new Worker(https://…/worker-HASH.js, { type: 'module' })` as an entry
 * script; importing the same URL from a blob worker reaches connect.
 *
 * The `Worker` patch is scoped to `factory()` so Vite still sees sqlocal's
 * own `new Worker(new URL('./worker', import.meta.url))` and emits a real
 * worker chunk.
 */
export function createSqlocalDrizzle<T>(factory: () => T): CreatedSqlocalDrizzle<T> {
  let rejectFailed: ((error: Error) => void) | undefined
  const workerFailed = new Promise<never>((_, reject) => {
    rejectFailed = reject
  })
  // Avoid an unhandled rejection if the caller throws before racing this promise.
  workerFailed.catch(() => {})

  const restore = installModuleWorkerBlobWrap((error) => {
    rejectFailed?.(error)
  })

  try {
    return { instance: factory(), workerFailed }
  } finally {
    restore()
  }
}

export async function raceSqlocalStartup<T>(
  work: Promise<T>,
  workerFailed: Promise<never>,
  timeoutMs: number = SQLOCAL_FIRST_QUERY_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `sqlocal database failed to become ready within ${timeoutMs}ms`,
        ),
      )
    }, timeoutMs)
  })

  try {
    return await Promise.race([work, workerFailed, timedOut])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

function installModuleWorkerBlobWrap(
  onWorkerFailed: (error: Error) => void,
): () => void {
  const OriginalWorker = globalThis.Worker
  if (typeof OriginalWorker === 'undefined') {
    return () => {}
  }

  function WrappedWorker(
    this: Worker,
    scriptURL: string | URL,
    options?: WorkerOptions,
  ): Worker {
    const worker = shouldBlobWrapModuleWorker(scriptURL, options)
      ? new OriginalWorker(
          URL.createObjectURL(
            new Blob([createBlobModuleWorkerSource(scriptURL)], {
              type: 'text/javascript',
            }),
          ),
          { ...options, type: 'module' },
        )
      : new OriginalWorker(scriptURL, options)

    const fail = (event: Event) => {
      const filename =
        'filename' in event && typeof event.filename === 'string'
          ? event.filename
          : ''
      const message =
        'message' in event && typeof event.message === 'string'
          ? event.message
          : event.type
      const error = new Error(
        filename
          ? `sqlocal worker failed to start (${event.type}): ${message} [${filename}]`
          : `sqlocal worker failed to start (${event.type}): ${message}`,
      )
      logger('[createSqlocalDrizzle] worker failed', error.message)
      onWorkerFailed(error)
    }

    worker.addEventListener('error', fail)
    worker.addEventListener('messageerror', fail)
    return worker
  }

  WrappedWorker.prototype = OriginalWorker.prototype
  Object.setPrototypeOf(WrappedWorker, OriginalWorker)
  globalThis.Worker = WrappedWorker as unknown as typeof Worker

  return () => {
    globalThis.Worker = OriginalWorker
  }
}

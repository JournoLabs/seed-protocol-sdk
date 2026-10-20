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

/**
 * Source of a module that replaces `self.Worker` inside sqlocal's worker. SQLite's OPFS VFS starts
 * its async proxy from there with `new Worker(new URL('sqlite3-opfs-async-proxy.js', import.meta.url))`,
 * and some Chromium builds fail any worker started from a worker with an http(s) URL (an `error`
 * event with no message). They do start a blob worker, so an http(s) URL is started from a blob that
 * loads it: `import` for a module worker, `importScripts` for a classic one. The classic blob also
 * resolves later `importScripts` calls against the original URL, because Vite dev prepends a
 * root-relative `importScripts("/@vite/env")`, which has no base inside a blob worker.
 *
 * Plain JS in a string so bundlers and transpilers can't add helpers that don't exist in the worker.
 */
export const NESTED_WORKER_SHIM_SOURCE = `(() => {
  const OriginalWorker = self.Worker;
  if (typeof OriginalWorker !== 'function' || OriginalWorker.__seedNestedWorkerWrap) return;
  const HTTP_URL = /^https?:/i;
  const classicSource = (url) =>
    'const __seedWorkerUrl = ' + JSON.stringify(url) + ';\\n' +
    'const __seedImportScripts = self.importScripts.bind(self);\\n' +
    'self.importScripts = (...urls) => __seedImportScripts(...urls.map((u) => new URL(String(u), __seedWorkerUrl).href));\\n' +
    '__seedImportScripts(__seedWorkerUrl);\\n';
  function NestedWorker(scriptURL, options) {
    const url = String(scriptURL);
    if (!HTTP_URL.test(url)) return new OriginalWorker(scriptURL, options);
    const isModule = options && options.type === 'module';
    const source = isModule ? 'import ' + JSON.stringify(url) + ';\\n' : classicSource(url);
    const blobUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new OriginalWorker(blobUrl, options);
    worker.addEventListener('error', (event) => {
      console.warn('[seed] A worker started inside the SQLite worker failed to load: ' + url, event.message || '');
    });
    return worker;
  }
  NestedWorker.prototype = OriginalWorker.prototype;
  Object.setPrototypeOf(NestedWorker, OriginalWorker);
  NestedWorker.__seedNestedWorkerWrap = true;
  self.Worker = NestedWorker;
})();
`

/**
 * Source of the blob module that starts sqlocal's worker. The shim is a separate import ahead of
 * the worker's: static imports are hoisted, so shim code in this module's body would run after the
 * worker module, while imports evaluate in the order they're written.
 */
export function createBlobModuleWorkerSource(scriptURL: string | URL, shimURL?: string): string {
  const workerImport = `import ${JSON.stringify(String(scriptURL))};`
  return shimURL ? `import ${JSON.stringify(shimURL)};\n${workerImport}` : workerImport
}

export type CreatedSqlocalDrizzle<T> = {
  instance: T
  workerFailed: Promise<never>
}

/**
 * Construct SQLocal while starting its HTTPS module worker from a blob that
 * only imports the bundled worker URL. Some Chrome profiles kill
 * `new Worker(https://…/worker-HASH.js, { type: 'module' })` as an entry
 * script; importing the same URL from a blob worker reaches connect. The blob also installs
 * {@link NESTED_WORKER_SHIM_SOURCE} first, for the OPFS proxy worker SQLite starts inside it.
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
    const toBlobURL = (source: string) =>
      URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const worker = shouldBlobWrapModuleWorker(scriptURL, options)
      ? new OriginalWorker(
          toBlobURL(
            createBlobModuleWorkerSource(scriptURL, toBlobURL(NESTED_WORKER_SHIM_SOURCE)),
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

import { addExcludedTransactions } from '@/db/write/addExcludedTransactions';
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager';
import filesDownload from './filesDownload'
import { notifyFilesWrittenOutsideCache } from '@/helpers/tabEvents'
import { contentSha256TagMatches } from '@/helpers/arweaveContentTags'
import debug from 'debug'

const logger = debug('seedSdk:browser:workers:FileDownloader')

/**
 * Longest the worker may go without posting anything before the download is failed. The worker
 * posts after every transaction and each gateway request times out after 60s, so this only fires
 * when the worker died without an error event (e.g. killed for memory) or is wedged.
 */
export const FILE_DOWNLOAD_INACTIVITY_TIMEOUT_MS = 5 * 60_000

export class FileDownloadWorkerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'FileDownloadWorkerError'
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause
  }
}

const toError = (raw: unknown, fallback: string): Error => {
  if (raw instanceof Error) return raw
  if (raw && typeof raw === 'object' && 'message' in raw) {
    const error = new FileDownloadWorkerError(String((raw as { message: unknown }).message))
    const name = (raw as { name?: unknown }).name
    if (typeof name === 'string' && name) error.name = name
    return error
  }
  return new FileDownloadWorkerError(raw == null ? fallback : String(raw))
}

export class FileDownloader {
  private cores: number
  private worker: Worker | undefined
  /** Settles the in-flight download, if any; used when a newer `downloadAll` supersedes it. */
  private abortCurrent: ((error: Error) => void) | undefined

  constructor(private readonly options: { inactivityTimeoutMs?: number } = {}) {
    this.cores = Math.min(navigator.hardwareConcurrency || 4, 4);
  }

  public downloadAll = async ({
    transactionIds,
    arweaveHost,
    arweaveBaseUrls,
    excludedTransactions,
    expectedContentHashes,
    compositeChildPaths,
    skipExisting,
  }: DownloadAllFilesParams): Promise<DownloadAllFilesResult> => {
    // One download per instance at a time: a newer call replaces the older one, which rejects
    // instead of waiting forever on a terminated worker.
    this.abortCurrent?.(new FileDownloadWorkerError('Superseded by a newer download'))

    const workerBlobUrl = globalThis.URL.createObjectURL(
      new Blob([filesDownload], { type: 'application/javascript' })
    )
    let worker: Worker
    try {
      worker = new Worker(workerBlobUrl)
    } catch (error) {
      globalThis.URL.revokeObjectURL(workerBlobUrl)
      throw error
    }
    this.worker = worker

    const localExcludedTransactions = new Set(excludedTransactions)
    const savedPaths: string[] = []
    const verified = new Set<string>()
    const hashMismatch = new Set<string>()
    const failed = new Set<string>()
    const inactivityTimeoutMs = this.options.inactivityTimeoutMs ?? FILE_DOWNLOAD_INACTIVITY_TIMEOUT_MS

    return new Promise<DownloadAllFilesResult>((resolve, reject) => {
      let settled = false
      let watchdog: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        if (watchdog) clearTimeout(watchdog)
        worker.onmessage = null
        worker.onerror = null
        worker.onmessageerror = null
        worker.terminate()
        globalThis.URL.revokeObjectURL(workerBlobUrl)
        if (this.worker === worker) this.worker = undefined
        if (this.abortCurrent === fail) this.abortCurrent = undefined
      }

      const fail = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        logger('file download failed', error)
        // Files the worker already wrote are on disk: refresh caches for them anyway.
        if (savedPaths.length) {
          void notifyFilesWrittenOutsideCache(savedPaths).catch(() => {})
        }
        reject(error)
      }

      const succeed = () => {
        if (settled) return
        settled = true
        cleanup()
        addExcludedTransactions(localExcludedTransactions)
          // The worker wrote to OPFS directly; refresh caches here and in other tabs.
          .then(() => notifyFilesWrittenOutsideCache(savedPaths))
          .then(() =>
            resolve({
              verifiedTransactionIds: [...verified].filter((id) => !failed.has(id)),
              hashMismatchTransactionIds: [...hashMismatch],
              failedTransactionIds: [...failed],
            }),
          )
          .catch(reject)
      }

      const armWatchdog = () => {
        if (watchdog) clearTimeout(watchdog)
        watchdog = setTimeout(
          () => fail(new FileDownloadWorkerError(
            `File download worker sent nothing for ${inactivityTimeoutMs}ms; assuming it stopped`,
          )),
          inactivityTimeoutMs,
        )
      }

      this.abortCurrent = fail

      worker.onmessage = (e) => {
        armWatchdog()
        const data = e.data ?? {}
        logger('filesDownload main thread onmessage', data);

        if (data.message === 'excludeTransaction') {
          localExcludedTransactions.add(data.transactionId)
        }

        if (data.message === 'fileSaved') {
          savedPaths.push(data.filePath)
        }

        if (data.message === 'verifyContent') {
          // The worker could not confirm the bytes itself (legacy SHA3-256 tag, or no WebCrypto).
          let ok = false
          try {
            ok = contentSha256TagMatches(new Uint8Array(data.bytes), String(data.expected ?? ''))
          } catch (error) {
            logger('content verification failed', error)
          }
          worker.postMessage({ message: 'verifyContentResult', requestId: data.requestId, ok })
          return
        }

        if (data.message === 'compositeChildUnrouted') {
          // No local ItemStorage property for this child (e.g. its item is not synced yet).
          logger(`composite ${data.transactionId}: no local path for child "${data.name}"; not saved`)
        }

        if (data.message === 'contentVerified') {
          verified.add(data.transactionId)
        }

        if (data.message === 'contentHashMismatch') {
          hashMismatch.add(data.transactionId)
          console.warn(
            `[FileDownloader] ${data.transactionId}: no gateway served bytes matching its Content-SHA-256 tag; not saved`,
          )
        }

        if (data.message === 'fileError') {
          failed.add(data.transactionId)
          // One file failed (e.g. OPFS write); the worker carries on with the rest.
          console.warn(
            `[FileDownloader] failed to save ${data.transactionId}: ${data.error?.name ?? 'Error'}: ${data.error?.message ?? ''}`,
          )
        }

        if (data.error && data.message !== 'fileError') {
          fail(toError(data.error, 'File download worker failed'))
          return
        }

        if (data.done) {
          succeed()
        }
      }

      worker.onerror = (event: ErrorEvent) => {
        // Keep it from also surfacing as an uncaught error; the promise carries it.
        event.preventDefault?.()
        const where = event.filename ? ` (${event.filename}:${event.lineno ?? 0})` : ''
        fail(new FileDownloadWorkerError(
          `File download worker error: ${event.message || 'unknown error'}${where}`,
          { cause: event.error },
        ))
      }

      worker.onmessageerror = () => {
        fail(new FileDownloadWorkerError('File download worker sent a message that could not be deserialized'))
      }

      armWatchdog()

      try {
        worker.postMessage({
          transactionIds,
          arweaveHost,
          arweaveBaseUrls,
          expectedContentHashes,
          compositeChildPaths,
          skipExisting,
          debug: logger.enabled,
          filesRoot: BaseFileManager.getWorkingDir(),
        });
      } catch (error) {
        fail(toError(error, 'Could not start the file download worker'))
      }
    })
  }
}

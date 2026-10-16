import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addExcludedTransactions: vi.fn(async () => undefined),
  notifyFilesWrittenOutsideCache: vi.fn(async () => undefined),
}))

vi.mock('@/db/write/addExcludedTransactions', () => ({
  addExcludedTransactions: mocks.addExcludedTransactions,
}))
vi.mock('@/helpers/tabEvents', () => ({
  notifyFilesWrittenOutsideCache: mocks.notifyFilesWrittenOutsideCache,
}))
vi.mock('@/helpers/FileManager/BaseFileManager', () => ({
  BaseFileManager: { getWorkingDir: () => '/files' },
}))

import { FileDownloader, FileDownloadWorkerError } from '@/browser/workers/FileDownloader'
import { getContentSha256 } from '@/helpers/arweaveContentTags'
import { sha3_256 } from '@noble/hashes/sha3'
import { bytesToHex } from '@noble/hashes/utils'

/** Stand-in for a dedicated Worker: the test drives its handlers directly. */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: Partial<ErrorEvent>) => void) | null = null
  onmessageerror: ((e: unknown) => void) | null = null
  posted: unknown[] = []
  terminated = false
  constructor(public url: string) {
    FakeWorker.instances.push(this)
  }
  postMessage(data: unknown) {
    this.posted.push(data)
  }
  terminate() {
    this.terminated = true
  }
  emit(data: unknown) {
    this.onmessage?.({ data })
  }
}

const params = {
  transactionIds: ['tx-1', 'tx-2'],
  arweaveHost: 'arweave.net',
  excludedTransactions: new Set<string>(),
}

const lastWorker = () => FakeWorker.instances[FakeWorker.instances.length - 1]!

describe.skipIf(typeof window !== 'undefined')('FileDownloader', () => {
  const revoked: string[] = []

  beforeEach(() => {
    FakeWorker.instances = []
    revoked.length = 0
    vi.clearAllMocks()
    vi.stubGlobal('Worker', FakeWorker)
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:worker-${FakeWorker.instances.length}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('resolves on done, records exclusions and refreshes caches for saved files', async () => {
    const p = new FileDownloader().downloadAll(params)
    const worker = lastWorker()
    worker.emit({ message: 'fileSaved', filePath: '/files/images/tx-1' })
    worker.emit({ message: 'excludeTransaction', transactionId: 'tx-2' })
    worker.emit({ message: 'filesDownload onmessage done', done: true })
    await expect(p).resolves.toEqual({
      verifiedTransactionIds: [],
      hashMismatchTransactionIds: [],
      failedTransactionIds: [],
    })

    expect(mocks.addExcludedTransactions).toHaveBeenCalledWith(new Set(['tx-2']))
    expect(mocks.notifyFilesWrittenOutsideCache).toHaveBeenCalledWith(['/files/images/tx-1'])
    expect(worker.terminated).toBe(true)
    expect(revoked).toEqual([worker.url])
  })

  it('rejects (and cleans up) when the worker throws, instead of waiting forever', async () => {
    const p = new FileDownloader().downloadAll(params)
    const worker = lastWorker()
    const preventDefault = vi.fn()
    worker.onerror?.({ message: 'Uncaught QuotaExceededError: disk full', filename: 'blob:x', lineno: 3, preventDefault })

    await expect(p).rejects.toBeInstanceOf(FileDownloadWorkerError)
    await expect(p).rejects.toThrow(/QuotaExceededError: disk full/)
    expect(preventDefault).toHaveBeenCalled()
    expect(worker.terminated).toBe(true)
    expect(revoked).toEqual([worker.url])
    expect(mocks.addExcludedTransactions).not.toHaveBeenCalled()
  })

  it('rejects on a message that cannot be deserialized', async () => {
    const p = new FileDownloader().downloadAll(params)
    lastWorker().onmessageerror?.({})
    await expect(p).rejects.toThrow(/could not be deserialized/)
  })

  it('rejects with the error the worker reports for the batch', async () => {
    const p = new FileDownloader().downloadAll(params)
    lastWorker().emit({ message: 'filesDownload failed', error: { name: 'TypeError', message: 'boom' } })
    await expect(p).rejects.toMatchObject({ name: 'TypeError', message: 'boom' })
  })

  it('a per-file error does not settle the download; done still resolves it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const p = new FileDownloader().downloadAll(params)
    const worker = lastWorker()
    worker.emit({ message: 'fileError', transactionId: 'tx-1', error: { name: 'QuotaExceededError', message: 'disk full' } })
    expect(worker.terminated).toBe(false)
    worker.emit({ message: 'filesDownload onmessage done', done: true })
    await expect(p).resolves.toMatchObject({ failedTransactionIds: ['tx-1'] })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tx-1'))
  })

  it('rejects when the worker goes silent (died without an error event)', async () => {
    vi.useFakeTimers()
    const p = new FileDownloader({ inactivityTimeoutMs: 1000 }).downloadAll(params)
    const assertion = expect(p).rejects.toThrow(/sent nothing for 1000ms/)
    lastWorker().emit({ message: 'fileProcessed', transactionId: 'tx-1' })
    await vi.advanceTimersByTimeAsync(999)
    lastWorker().emit({ message: 'fileProcessed', transactionId: 'tx-2' })
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(lastWorker().terminated).toBe(true)
  })

  it('a newer download on the same instance rejects the older one instead of orphaning it', async () => {
    const downloader = new FileDownloader()
    const first = downloader.downloadAll(params)
    const firstWorker = lastWorker()
    const second = downloader.downloadAll(params)
    await expect(first).rejects.toThrow(/Superseded/)
    expect(firstWorker.terminated).toBe(true)
    lastWorker().emit({ done: true })
    await expect(second).resolves.toBeDefined()
  })

  it('passes expected hashes to the worker, answers its verification requests and reports the outcome', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bytes = new TextEncoder().encode('legacy content')
    const legacy = bytesToHex(sha3_256(bytes))
    const p = new FileDownloader().downloadAll({ ...params, expectedContentHashes: { 'tx-1': legacy } })
    const worker = lastWorker()
    expect(worker.posted[0]).toMatchObject({ expectedContentHashes: { 'tx-1': legacy } })

    worker.emit({ message: 'verifyContent', requestId: 7, transactionId: 'tx-1', expected: legacy, bytes: bytes.buffer })
    worker.emit({ message: 'verifyContent', requestId: 8, transactionId: 'tx-2', expected: getContentSha256(new Uint8Array([1])), bytes: bytes.buffer })
    expect(worker.posted.slice(1)).toEqual([
      { message: 'verifyContentResult', requestId: 7, ok: true },
      { message: 'verifyContentResult', requestId: 8, ok: false },
    ])

    worker.emit({ message: 'contentVerified', transactionId: 'tx-1' })
    worker.emit({ message: 'contentHashMismatch', transactionId: 'tx-2' })
    worker.emit({ done: true })
    await expect(p).resolves.toEqual({
      verifiedTransactionIds: ['tx-1'],
      hashMismatchTransactionIds: ['tx-2'],
      failedTransactionIds: [],
    })
  })

  it('passes composite child paths to the worker and tolerates an unrouted child', async () => {
    const compositeChildPaths = { 'tx-1': { cover: 'files/tx-1.bin' } }
    const p = new FileDownloader().downloadAll({ ...params, compositeChildPaths })
    const worker = lastWorker()
    expect(worker.posted[0]).toMatchObject({ compositeChildPaths })
    worker.emit({ message: 'compositeChildUnrouted', transactionId: 'tx-2', name: 'notes' })
    worker.emit({ done: true })
    await expect(p).resolves.toEqual({
      verifiedTransactionIds: [],
      hashMismatchTransactionIds: [],
      failedTransactionIds: [],
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const VALID_ARWEAVE_TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'

const mocks = vi.hoisted(() => {
  const appDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([]),
      })),
    })),
  }

  return {
    isBrowser: vi.fn(() => true),
    getAllAddressesFromDb: vi.fn(async () => ['0xabc']),
    getAppDb: vi.fn(() => appDb),
    isAppDbReady: vi.fn(() => true),
    fetchQuery: vi.fn(),
    removeQueries: vi.fn(),
    request: vi.fn(),
    getTransactionStatus: vi.fn(async () => ({ status: 200 })),
    getTransactionTags: vi.fn(async () => []),
    getHost: vi.fn(() => 'arweave.net'),
    getMetadata: vi.fn(async () => null),
    saveMetadata: vi.fn(async () => undefined),
    saveAppState: vi.fn(async () => undefined),
    downloadAllFiles: vi.fn(async () => undefined),
    downloadFileByTransactionId: vi.fn(async () => undefined),
    resizeAllImages: vi.fn(async () => undefined),
    ensureReadGatewaySelected: vi.fn(async () => undefined),
    createDirIfNotExists: vi.fn(async () => undefined),
    getWorkingDir: vi.fn(() => '/app-files'),
    getFilesPath: vi.fn((...parts: string[]) => `/app-files/${parts.join('/')}`.replace(/\/+/g, '/')),
    eventEmit: vi.fn(),
  }
})

vi.mock('@/helpers/environment', () => ({
  isBrowser: mocks.isBrowser,
  isElectronRenderer: vi.fn(() => false),
  supportsOpfsFileDownloads: vi.fn(() => mocks.isBrowser() as boolean),
}))

vi.mock('@/helpers/db', () => ({
  getAllAddressesFromDb: mocks.getAllAddressesFromDb,
}))

vi.mock('@/db/Db/BaseDb', () => ({
  BaseDb: {
    getAppDb: mocks.getAppDb,
    isAppDbReady: mocks.isAppDbReady,
  },
}))

vi.mock('@/helpers', () => ({
  BaseFileManager: {
    downloadAllFiles: mocks.downloadAllFiles,
    downloadFileByTransactionId: mocks.downloadFileByTransactionId,
    resizeAllImages: mocks.resizeAllImages,
    createDirIfNotExists: mocks.createDirIfNotExists,
    getWorkingDir: mocks.getWorkingDir,
    getFilesPath: mocks.getFilesPath,
  },
  ensureReadGatewaySelected: mocks.ensureReadGatewaySelected,
  BaseEasClient: {
    getEasClient: () => ({
      request: mocks.request,
    }),
  },
  BaseQueryClient: {
    getQueryClient: () => ({
      fetchQuery: mocks.fetchQuery,
      removeQueries: mocks.removeQueries,
    }),
  },
  BaseArweaveClient: {
    getTransactionStatus: mocks.getTransactionStatus,
    getTransactionTags: mocks.getTransactionTags,
    getHost: mocks.getHost,
  },
}))

vi.mock('@/db/read/getMetadata', () => ({
  getMetadata: mocks.getMetadata,
}))

vi.mock('@/db/write/saveMetadata', () => ({
  saveMetadata: mocks.saveMetadata,
}))

vi.mock('@/db/write/saveAppState', () => ({
  saveAppState: mocks.saveAppState,
}))

vi.mock('@/eventBus', () => ({
  eventEmitter: {
    emit: mocks.eventEmit,
  },
}))

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('events/files/download dedupe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchQuery.mockImplementation(async ({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'getFilesMetadata') {
        return {
          filesMetadata: [
            {
              id: 'meta-1',
              decodedDataJson: JSON.stringify([{ value: { value: VALID_ARWEAVE_TX } }]),
            },
          ],
        }
      }
      if (queryKey[0] === 'getTransactionTags') {
        return []
      }
      return []
    })
    mocks.request.mockImplementation(async () => ({ filesMetadata: [] }))
  })

  it('dedupes concurrent bulk binary handlers', async () => {
    const deferred = createDeferred<void>()
    mocks.downloadFileByTransactionId.mockImplementationOnce(async () => deferred.promise)

    const mod = await import('@/events/files/download')
    const p1 = mod.downloadAllFilesBinaryRequestHandler()
    const p2 = mod.downloadAllFilesBinaryRequestHandler()

    await vi.waitFor(() => {
      expect(mocks.downloadFileByTransactionId).toHaveBeenCalledTimes(1)
    })
    expect(mocks.downloadAllFiles).toHaveBeenCalledTimes(0)

    deferred.resolve()
    await Promise.all([p1, p2])
  })

  it('dedupes concurrent lazy downloads for same transaction', async () => {
    const deferred = createDeferred<void>()
    mocks.downloadFileByTransactionId.mockImplementationOnce(async () => deferred.promise)

    const mod = await import('@/events/files/download')
    const p1 = mod.downloadTransactionIdWithDedupe(VALID_ARWEAVE_TX)
    const p2 = mod.downloadTransactionIdWithDedupe(VALID_ARWEAVE_TX)

    await vi.waitFor(() => {
      expect(mocks.downloadFileByTransactionId).toHaveBeenCalledTimes(1)
    })

    deferred.resolve()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(true)
    expect(r2).toBe(true)
  })

  it('refetches files metadata once when first cached result is empty', async () => {
    let getFilesMetadataCalls = 0
    mocks.fetchQuery.mockImplementation(async ({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'getFilesMetadata') {
        getFilesMetadataCalls += 1
        if (getFilesMetadataCalls === 1) {
          return { filesMetadata: [] }
        }
        return {
          filesMetadata: [
            {
              id: 'meta-1',
              decodedDataJson: JSON.stringify([{ value: { value: VALID_ARWEAVE_TX } }]),
            },
          ],
        }
      }
      if (queryKey[0] === 'getTransactionTags') {
        return []
      }
      return []
    })

    const mod = await import('@/events/files/download')
    await mod.downloadAllFilesBinaryRequestHandler()

    expect(mocks.removeQueries).toHaveBeenCalledTimes(1)
    expect(getFilesMetadataCalls).toBe(2)
    expect(mocks.downloadFileByTransactionId).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: VALID_ARWEAVE_TX }),
    )
  })

  it('parses arweave tx id embedded in a gateway URL from EAS decodedDataJson', async () => {
    const url = `https://arweave.net/${VALID_ARWEAVE_TX}`
    mocks.fetchQuery.mockImplementation(async ({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'getFilesMetadata') {
        return {
          filesMetadata: [
            {
              id: 'meta-url',
              decodedDataJson: JSON.stringify([{ value: { value: url } }]),
            },
          ],
        }
      }
      if (queryKey[0] === 'getTransactionTags') {
        return []
      }
      return []
    })

    const mod = await import('@/events/files/download')
    await mod.downloadTransactionIdWithDedupe(url)

    expect(mocks.downloadFileByTransactionId).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: VALID_ARWEAVE_TX }),
    )
  })
})

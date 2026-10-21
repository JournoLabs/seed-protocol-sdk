import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

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
    getTransactionTagsByIds: vi.fn(async (_ids: string[], _opts?: unknown) => new Map<string, { name: string; value: string }[]>()),
    getArweaveClient: vi.fn(() => ({ request: vi.fn() })),
    getQueryData: vi.fn((_key: unknown): unknown => undefined),
    getHost: vi.fn(() => 'arweave.net'),
    getBaseUrl: vi.fn(() => 'https://arweave.net'),
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
      getQueryData: mocks.getQueryData,
    }),
  },
  BaseArweaveClient: {
    getTransactionStatus: mocks.getTransactionStatus,
    getTransactionTags: mocks.getTransactionTags,
    getArweaveClient: mocks.getArweaveClient,
    getHost: mocks.getHost,
    getBaseUrl: mocks.getBaseUrl,
  },
}))

vi.mock('@seedprotocol/arweave', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTransactionTagsByIds: mocks.getTransactionTagsByIds,
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
    }, { timeout: WAIT_TIMEOUT_MS })
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
    }, { timeout: WAIT_TIMEOUT_MS })

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

  // A storage_transaction_id attested under the legacy `bytes32` schema decodes as 0x…20.
  it('skips bytes32 values instead of downloading a 43-character slice of them', async () => {
    const bytes32 = '0x' + '0'.repeat(62) + '20'
    mocks.fetchQuery.mockImplementation(async ({ queryKey }: { queryKey: unknown[] }) => {
      if (queryKey[0] === 'getFilesMetadata') {
        return {
          filesMetadata: [
            { id: 'meta-bytes32', decodedDataJson: JSON.stringify([{ value: { value: bytes32 } }]) },
            { id: 'meta-1', decodedDataJson: JSON.stringify([{ value: { value: VALID_ARWEAVE_TX } }]) },
          ],
        }
      }
      return []
    })

    const mod = await import('@/events/files/download')
    await mod.downloadAllFilesBinaryRequestHandler()
    expect(mocks.downloadFileByTransactionId).toHaveBeenCalledTimes(1)
    expect(mocks.downloadFileByTransactionId).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: VALID_ARWEAVE_TX }),
    )

    vi.clearAllMocks()
    expect(await mod.downloadTransactionIdWithDedupe(bytes32)).toBe(false)
    expect(await mod.downloadTransactionIdWithDedupe(`https://arweave.net/${bytes32}`)).toBe(false)
    expect(mocks.downloadFileByTransactionId).not.toHaveBeenCalled()
    expect(mocks.downloadAllFiles).not.toHaveBeenCalled()
  })

  describe('Content-SHA-256', () => {
    const TX_B = 'B'.repeat(43)
    const TX_C = 'C'.repeat(43)
    const HASH_A = 'a'.repeat(64)
    const HASH_B = 'b'.repeat(64)

    const withEasTransactions = (ids: string[]) =>
      mocks.fetchQuery.mockImplementation(async ({ queryKey, queryFn }: { queryKey: unknown[]; queryFn?: () => unknown }) => {
        if (queryKey[0] === 'getFilesMetadata') {
          return {
            filesMetadata: ids.map((id, i) => ({
              id: `meta-${i}`,
              decodedDataJson: JSON.stringify([{ value: { value: id } }]),
            })),
          }
        }
        return queryFn ? queryFn() : []
      })

    it('looks the tags up in one batch and verifies downloads against them', async () => {
      withEasTransactions([VALID_ARWEAVE_TX, TX_B, TX_C])
      mocks.getTransactionTagsByIds.mockResolvedValueOnce(
        new Map([
          [VALID_ARWEAVE_TX, [{ name: 'Content-SHA-256', value: HASH_A }, { name: 'Content-Type', value: 'image/png' }]],
          [TX_B, [{ name: 'Content-SHA-256', value: HASH_B }]],
          // TX_C: not indexed yet, no tags
        ]),
      )
      mocks.downloadAllFiles.mockResolvedValueOnce({
        verifiedTransactionIds: [VALID_ARWEAVE_TX],
        hashMismatchTransactionIds: [TX_B],
        failedTransactionIds: [],
      } as any)

      const mod = await import('@/events/files/download')
      await mod.downloadAllFilesBinaryRequestHandler()

      expect(mocks.getTransactionTagsByIds).toHaveBeenCalledTimes(1)
      expect(mocks.getTransactionTagsByIds.mock.calls[0]![0]).toEqual([VALID_ARWEAVE_TX, TX_B, TX_C])
      expect(mocks.getTransactionTags).not.toHaveBeenCalled()
      expect(mocks.downloadAllFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionIds: [VALID_ARWEAVE_TX, TX_B, TX_C],
          expectedContentHashes: { [VALID_ARWEAVE_TX]: HASH_A, [TX_B]: HASH_B },
        }),
      )
    })

    it('uses cached tags instead of asking again', async () => {
      mocks.getQueryData.mockImplementation((key: any) =>
        key[1] === VALID_ARWEAVE_TX ? [{ name: 'Content-SHA-256', value: HASH_A }] : undefined,
      )
      const mod = await import('@/events/files/download')
      await mod.downloadTransactionIdWithDedupe(VALID_ARWEAVE_TX)

      expect(mocks.getTransactionTagsByIds).not.toHaveBeenCalled()
      expect(mocks.downloadFileByTransactionId).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: VALID_ARWEAVE_TX, expectedContentHash: HASH_A }),
      )
      mocks.getQueryData.mockImplementation(() => undefined)
    })

    it('a failed tag lookup does not stop the download (it is just unverified)', async () => {
      mocks.getTransactionTagsByIds.mockRejectedValueOnce(new Error('graphql down'))
      const mod = await import('@/events/files/download')
      await expect(mod.downloadTransactionIdWithDedupe(VALID_ARWEAVE_TX)).resolves.toBe(true)

      expect(mocks.downloadFileByTransactionId).toHaveBeenCalledWith(
        expect.objectContaining({ transactionId: VALID_ARWEAVE_TX, expectedContentHash: undefined }),
      )
    })
  })
})

/** Audit V10 (G21-2): the worker skips files already on disk; the handler only has to ask it to. */
describe('events/files/download skips files on disk', () => {
  const TX_B = 'B'.repeat(43)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchQuery.mockImplementation(async ({ queryKey, queryFn }: { queryKey: unknown[]; queryFn?: () => unknown }) => {
      if (queryKey[0] === 'getFilesMetadata') {
        return {
          filesMetadata: [VALID_ARWEAVE_TX, TX_B].map((id, i) => ({
            id: `meta-${i}`,
            decodedDataJson: JSON.stringify([{ value: { value: id } }]),
          })),
        }
      }
      return queryFn ? queryFn() : []
    })
    mocks.getTransactionTagsByIds.mockImplementation(async (ids: string[]) =>
      new Map(ids.map((id) => [id, [{ name: 'Content-SHA-256', value: id[0]!.repeat(64) }]])),
    )
    mocks.downloadAllFiles.mockImplementation((async (params: any) => ({
      verifiedTransactionIds: params.transactionIds,
      hashMismatchTransactionIds: [],
      failedTransactionIds: [],
    })) as any)
  })

  it('bulk runs ask the worker to skip files on disk and do not bulk-resize images', async () => {
    const mod = await import('@/events/files/download')
    await mod.downloadAllFilesBinaryRequestHandler()
    await mod.downloadAllFilesBinaryRequestHandler()

    expect(mocks.downloadAllFiles).toHaveBeenCalledTimes(2)
    for (const [params] of mocks.downloadAllFiles.mock.calls as any[]) {
      expect(params).toMatchObject({ transactionIds: [VALID_ARWEAVE_TX, TX_B], skipExisting: true })
    }
    expect(mocks.resizeAllImages).not.toHaveBeenCalled()
  })

  it('a lazy download of one file does not skip: its caller found no local file', async () => {
    const mod = await import('@/events/files/download')
    await mod.downloadTransactionIdWithDedupe(VALID_ARWEAVE_TX)

    expect(mocks.downloadFileByTransactionId).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: VALID_ARWEAVE_TX, skipExisting: undefined }),
    )
  })
})

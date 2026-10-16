import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageSize } from '@/helpers/constants'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const VALID_ARWEAVE_TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'

const mocks = vi.hoisted(() => {
  const pathExists = vi.fn(async (_path: string) => false)
  const resizeImage = vi.fn(async () => undefined)
  const downloadTransactionIdWithDedupe = vi.fn(async () => true)
  const supportsOpfsFileDownloads = vi.fn(() => true)
  const readdir = vi.fn(async () => [] as string[])
  const stat = vi.fn(async () => ({ isFile: () => true }))
  const getFs = vi.fn(async () => ({
    promises: {
      readdir,
      stat,
    },
  }))

  return {
    pathExists,
    resizeImage,
    downloadTransactionIdWithDedupe,
    supportsOpfsFileDownloads,
    readdir,
    stat,
    getFs,
    getFilesPath: vi.fn((...parts: string[]) =>
      `/app-files/${parts.join('/')}`.replace(/\/+/g, '/'),
    ),
    getPathModule: vi.fn(() => ({
      basename: (p: string) => p.split('/').pop() || p,
      dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/',
      join: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
    })),
  }
})

vi.mock('@/helpers/environment', () => ({
  supportsOpfsFileDownloads: mocks.supportsOpfsFileDownloads,
  isBrowser: vi.fn(() => true),
  isElectronRenderer: vi.fn(() => false),
}))

vi.mock('@/events/files/download', () => ({
  downloadTransactionIdWithDedupe: mocks.downloadTransactionIdWithDedupe,
}))

vi.mock('@/helpers/FileManager/BaseFileManager', () => ({
  BaseFileManager: {
    pathExists: mocks.pathExists,
    resizeImage: mocks.resizeImage,
    getFilesPath: mocks.getFilesPath,
    getPathModule: mocks.getPathModule,
    getFs: mocks.getFs,
  },
}))

describe('ensureImageLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.supportsOpfsFileDownloads.mockReturnValue(true)
    mocks.pathExists.mockResolvedValue(false)
    mocks.readdir.mockResolvedValue([])
    mocks.stat.mockResolvedValue({ isFile: () => true })
    mocks.downloadTransactionIdWithDedupe.mockResolvedValue(true)
    mocks.resizeImage.mockResolvedValue(undefined)
  })

  it('returns unsupported when OPFS downloads are not available', async () => {
    mocks.supportsOpfsFileDownloads.mockReturnValue(false)
    const { ensureImageLocal, resetEnsureImageLocalInFlightForTests } = await import(
      '@/helpers/ensureImageLocal'
    )
    resetEnsureImageLocalInFlightForTests()

    const result = await ensureImageLocal({ transactionId: VALID_ARWEAVE_TX })
    expect(result.status).toBe('unsupported')
    expect(mocks.downloadTransactionIdWithDedupe).not.toHaveBeenCalled()
  })

  it('returns missing-id when no transactionId or fileName', async () => {
    const { ensureImageLocal, resetEnsureImageLocalInFlightForTests } = await import(
      '@/helpers/ensureImageLocal'
    )
    resetEnsureImageLocalInFlightForTests()

    const result = await ensureImageLocal({})
    expect(result.status).toBe('missing-id')
  })

  it('downloads missing original then resizes closest ImageSize', async () => {
    const originalPath = `/app-files/images/${VALID_ARWEAVE_TX}`
    const variantPath = `/app-files/images/480/${VALID_ARWEAVE_TX}.webp`
    let downloaded = false

    mocks.pathExists.mockImplementation(async (p: string) => {
      if (p === '/app-files/images') return true
      if (p === originalPath) return downloaded
      if (p === variantPath) return false
      return false
    })
    mocks.readdir.mockImplementation(async () => (downloaded ? [VALID_ARWEAVE_TX] : []))
    mocks.downloadTransactionIdWithDedupe.mockImplementation(async () => {
      downloaded = true
      return true
    })

    const { ensureImageLocal, resetEnsureImageLocalInFlightForTests } = await import(
      '@/helpers/ensureImageLocal'
    )
    resetEnsureImageLocalInFlightForTests()

    const result = await ensureImageLocal({
      transactionId: VALID_ARWEAVE_TX,
      widths: [450],
    })

    expect(mocks.downloadTransactionIdWithDedupe).toHaveBeenCalledWith(VALID_ARWEAVE_TX)
    expect(mocks.resizeImage).toHaveBeenCalledWith({
      filePath: originalPath,
      width: ImageSize.EXTRA_SMALL,
      height: ImageSize.EXTRA_SMALL,
    })
    expect(result.status).toBe('ready')
    expect(result.filePath).toBe(originalPath)
    expect(result.createdWidths).toEqual([ImageSize.EXTRA_SMALL])
  })

  it('skips download when original exists and only creates missing variant', async () => {
    const originalPath = `/app-files/images/${VALID_ARWEAVE_TX}`
    const variantPath = `/app-files/images/1024/${VALID_ARWEAVE_TX}.webp`

    mocks.pathExists.mockImplementation(async (p: string) => {
      if (p === '/app-files/images') return true
      if (p === originalPath) return true
      if (p === variantPath) return false
      return false
    })
    mocks.readdir.mockResolvedValue([VALID_ARWEAVE_TX])

    const { ensureImageLocal, resetEnsureImageLocalInFlightForTests } = await import(
      '@/helpers/ensureImageLocal'
    )
    resetEnsureImageLocalInFlightForTests()

    const result = await ensureImageLocal({
      transactionId: VALID_ARWEAVE_TX,
      widths: [1000],
    })

    expect(mocks.downloadTransactionIdWithDedupe).not.toHaveBeenCalled()
    expect(mocks.resizeImage).toHaveBeenCalledWith({
      filePath: originalPath,
      width: ImageSize.MEDIUM,
      height: ImageSize.MEDIUM,
    })
    expect(result.status).toBe('ready')
    expect(result.createdWidths).toEqual([ImageSize.MEDIUM])
  })

  it('does not resize when variant already exists', async () => {
    const originalPath = `/app-files/images/${VALID_ARWEAVE_TX}`
    const variantPath = `/app-files/images/480/${VALID_ARWEAVE_TX}.webp`

    mocks.pathExists.mockImplementation(async (p: string) => {
      if (p === '/app-files/images') return true
      if (p === originalPath) return true
      if (p === variantPath) return true
      return false
    })
    mocks.readdir.mockResolvedValue([VALID_ARWEAVE_TX])

    const { ensureImageLocal, resetEnsureImageLocalInFlightForTests } = await import(
      '@/helpers/ensureImageLocal'
    )
    resetEnsureImageLocalInFlightForTests()

    const result = await ensureImageLocal({
      transactionId: VALID_ARWEAVE_TX,
      widths: [480],
    })

    expect(mocks.resizeImage).not.toHaveBeenCalled()
    expect(result.status).toBe('ready')
    expect(result.createdWidths).toEqual([])
  })

  it('dedupes concurrent ensures for the same key', async () => {
    const originalPath = `/app-files/images/${VALID_ARWEAVE_TX}`
    let resolveDownload!: () => void
    const downloadPromise = new Promise<boolean>((resolve) => {
      resolveDownload = () => resolve(true)
    })

    mocks.pathExists.mockImplementation(async (p: string) => {
      if (p === '/app-files/images') return true
      if (p === originalPath) return true
      return false
    })
    mocks.readdir.mockResolvedValue([])
    mocks.downloadTransactionIdWithDedupe.mockImplementation(async () => {
      await downloadPromise
      mocks.readdir.mockResolvedValue([VALID_ARWEAVE_TX])
      return true
    })

    const { ensureImageLocal, resetEnsureImageLocalInFlightForTests } = await import(
      '@/helpers/ensureImageLocal'
    )
    resetEnsureImageLocalInFlightForTests()

    const p1 = ensureImageLocal({ transactionId: VALID_ARWEAVE_TX, widths: [480] })
    const p2 = ensureImageLocal({ transactionId: VALID_ARWEAVE_TX, widths: [480] })

    await vi.waitFor(() => {
      expect(mocks.downloadTransactionIdWithDedupe).toHaveBeenCalledTimes(1)
    }, { timeout: WAIT_TIMEOUT_MS })

    resolveDownload()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.status).toBe('ready')
    expect(r2.status).toBe('ready')
  })
})

describe('closestImageSize', () => {
  it('maps display widths to ImageSize buckets', async () => {
    const { closestImageSize } = await import('@/helpers/ensureImageLocal')
    expect(closestImageSize(450)).toBe(ImageSize.EXTRA_SMALL)
    expect(closestImageSize(800)).toBe(ImageSize.SMALL)
    expect(closestImageSize(1100)).toBe(ImageSize.MEDIUM)
    expect(closestImageSize(1500)).toBe(ImageSize.LARGE)
    expect(closestImageSize(2000)).toBe(ImageSize.EXTRA_LARGE)
  })
})

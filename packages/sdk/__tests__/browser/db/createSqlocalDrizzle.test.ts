import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBlobModuleWorkerSource,
  createSqlocalDrizzle,
  raceSqlocalStartup,
  shouldBlobWrapModuleWorker,
} from '@/browser/db/createSqlocalDrizzle'

class MockWorker extends EventTarget {
  scriptURL: string | URL
  options?: WorkerOptions

  constructor(scriptURL: string | URL, options?: WorkerOptions) {
    super()
    this.scriptURL = scriptURL
    this.options = options
  }
}

describe('createSqlocalDrizzle', () => {
  const originalWorker = globalThis.Worker
  const originalCreateObjectURL = URL.createObjectURL
  const createdBlobs: Blob[] = []

  afterEach(() => {
    globalThis.Worker = originalWorker
    URL.createObjectURL = originalCreateObjectURL
    createdBlobs.length = 0
    vi.restoreAllMocks()
  })

  function installMocks() {
    globalThis.Worker = MockWorker as unknown as typeof Worker
    URL.createObjectURL = ((blob: Blob) => {
      createdBlobs.push(blob)
      return `blob:mock/${createdBlobs.length}`
    }) as typeof URL.createObjectURL
  }

  describe('shouldBlobWrapModuleWorker', () => {
    it('wraps http(s) module workers', () => {
      expect(
        shouldBlobWrapModuleWorker('https://example.com/assets/worker-abc.js', {
          type: 'module',
        }),
      ).toBe(true)
      expect(
        shouldBlobWrapModuleWorker(new URL('http://localhost:5173/worker.js'), {
          type: 'module',
        }),
      ).toBe(true)
    })

    it('does not wrap classic workers or blob/data URLs', () => {
      expect(
        shouldBlobWrapModuleWorker('https://example.com/worker.js'),
      ).toBe(false)
      expect(
        shouldBlobWrapModuleWorker('blob:https://example.com/abc', {
          type: 'module',
        }),
      ).toBe(false)
      expect(
        shouldBlobWrapModuleWorker('data:text/javascript,void 0', {
          type: 'module',
        }),
      ).toBe(false)
    })
  })

  it('creates a blob source that only imports the worker URL', () => {
    expect(createBlobModuleWorkerSource('https://example.com/worker-HASH.js')).toBe(
      'import "https://example.com/worker-HASH.js";',
    )
  })

  it('starts https module workers from a blob that imports the original URL', async () => {
    installMocks()
    const url = 'https://example.com/assets/worker-HASH.js'

    const { instance } = createSqlocalDrizzle(
      () => new Worker(url, { type: 'module' }),
    )
    const worker = instance as unknown as MockWorker

    expect(String(worker.scriptURL)).toMatch(/^blob:/)
    expect(worker.options?.type).toBe('module')
    expect(createdBlobs).toHaveLength(1)
    await expect(createdBlobs[0].text()).resolves.toBe(`import ${JSON.stringify(url)};`)
  })

  it('does not wrap classic or blob workers', () => {
    installMocks()

    const classic = createSqlocalDrizzle(
      () => new Worker('https://example.com/classic.js'),
    ).instance as unknown as MockWorker
    expect(String(classic.scriptURL)).toBe('https://example.com/classic.js')

    const blobWorker = createSqlocalDrizzle(
      () => new Worker('blob:https://example.com/already', { type: 'module' }),
    ).instance as unknown as MockWorker
    expect(String(blobWorker.scriptURL)).toBe('blob:https://example.com/already')
    expect(createdBlobs).toEqual([])
  })

  it('restores Worker after success and after factory throw', () => {
    installMocks()
    const mockedWorker = globalThis.Worker

    createSqlocalDrizzle(() => 'ok')
    expect(globalThis.Worker).toBe(mockedWorker)

    expect(() =>
      createSqlocalDrizzle(() => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(globalThis.Worker).toBe(mockedWorker)
  })

  it('rejects workerFailed when the worker emits error', async () => {
    installMocks()
    const { instance, workerFailed } = createSqlocalDrizzle(
      () => new Worker('https://example.com/worker.js', { type: 'module' }),
    )

    ;(instance as unknown as MockWorker).dispatchEvent(new Event('error'))

    await expect(workerFailed).rejects.toThrow(/sqlocal worker failed to start/)
  })

  it('races startup work against workerFailed and timeout', async () => {
    await expect(
      raceSqlocalStartup(
        new Promise(() => {}),
        new Promise(() => {}),
        20,
      ),
    ).rejects.toThrow(/failed to become ready within 20ms/)

    const workerFailed = Promise.reject(new Error('sqlocal worker failed to start (error): error'))
    workerFailed.catch(() => {})
    await expect(
      raceSqlocalStartup(new Promise(() => {}), workerFailed as Promise<never>, 5_000),
    ).rejects.toThrow(/sqlocal worker failed to start/)

    await expect(
      raceSqlocalStartup(Promise.resolve('ready'), new Promise(() => {}), 5_000),
    ).resolves.toBe('ready')
  })
})

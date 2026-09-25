import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import type { IFileManager } from '@/helpers/FileManager/IFileManager'

function createMockImpl(
  initializeFileSystem: IFileManager['initializeFileSystem'],
): IFileManager {
  return {
    initializeFileSystem,
    getContentUrlFromPath: async () => undefined,
    downloadAllFiles: async () => {},
    resizeImage: async () => {},
    resizeAllImages: async () => {},
    pathExists: async () => false,
    getFileSize: async () => null,
    listFiles: async () => [],
    listImageFiles: async () => [],
    createDirIfNotExists: async () => {},
    waitForFile: async () => false,
    waitForFileWithContent: async () => false,
    saveFile: async () => {},
    saveFileSync: () => {},
    readFile: async () => new File([], 'empty'),
    readFileSync: () => new File([], 'empty'),
    readFileAsBuffer: async () => new Blob(),
    readFileAsString: async () => '',
    getFs: async () => ({}),
    getFsSync: () => ({}),
    getPathModule: () => ({}),
    getParentDirPath: (filePath: string) => filePath,
    getFilenameFromPath: (filePath: string) => filePath,
  }
}

describe('BaseFileManager.initializeFileSystem', () => {
  afterEach(() => {
    BaseFileManager.resetInitializationState()
  })

  it('resets flags after a failed init so a later call retries', async () => {
    const initializeFileSystem = vi
      .fn<IFileManager['initializeFileSystem']>()
      .mockRejectedValueOnce(new Error('configure failed'))
      .mockResolvedValueOnce(undefined)

    BaseFileManager.configure(createMockImpl(initializeFileSystem))

    await expect(BaseFileManager.initializeFileSystem('.seed')).rejects.toThrow(
      'configure failed',
    )
    expect(initializeFileSystem).toHaveBeenCalledTimes(1)

    await expect(BaseFileManager.initializeFileSystem('.seed')).resolves.toBeUndefined()
    expect(initializeFileSystem).toHaveBeenCalledTimes(2)
    expect(BaseFileManager.getWorkingDir()).toBe('.seed')
  })

  it('shares one in-flight promise across concurrent callers', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const initializeFileSystem = vi.fn(async () => {
      await gate
    })

    BaseFileManager.configure(createMockImpl(initializeFileSystem))

    const first = BaseFileManager.initializeFileSystem('/app-files')
    const second = BaseFileManager.initializeFileSystem('/app-files')
    expect(first).toBe(second)
    expect(initializeFileSystem).toHaveBeenCalledTimes(1)

    release()
    await expect(first).resolves.toBeUndefined()
    await expect(second).resolves.toBeUndefined()
    expect(initializeFileSystem).toHaveBeenCalledTimes(1)
  })

  it('no-ops after a successful init', async () => {
    const initializeFileSystem = vi.fn(async () => {})
    BaseFileManager.configure(createMockImpl(initializeFileSystem))

    await BaseFileManager.initializeFileSystem('.seed')
    await BaseFileManager.initializeFileSystem('.seed')

    expect(initializeFileSystem).toHaveBeenCalledTimes(1)
  })
})

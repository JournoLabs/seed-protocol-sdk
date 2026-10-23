import { afterEach, describe, expect, it } from 'vitest'
import { checkBrowserSupport } from '@/helpers/browserSupport'
import { UnsupportedBrowserError } from '@/helpers/FileManager/errors'
import { BrowserFileManager } from '@/browser/helpers/FileManager'

const createWritable = Object.getOwnPropertyDescriptor(FileSystemFileHandle.prototype, 'createWritable')!

describe('checkBrowserSupport', () => {
  afterEach(() => {
    Object.defineProperty(FileSystemFileHandle.prototype, 'createWritable', createWritable)
  })

  it('finds nothing missing in the test browser', () => {
    expect(checkBrowserSupport()).toEqual({ supported: true, missing: [] })
  })

  it('reports a browser without createWritable, as Safari before 26', () => {
    delete (FileSystemFileHandle.prototype as Partial<FileSystemFileHandle>).createWritable
    expect(checkBrowserSupport()).toEqual({ supported: false, missing: ['opfs-writable'] })
  })

  it('fails file system init with UnsupportedBrowserError before ZenFS loads', async () => {
    delete (FileSystemFileHandle.prototype as Partial<FileSystemFileHandle>).createWritable
    const fileManager = new BrowserFileManager()
    const error = await fileManager.initializeFileSystem().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnsupportedBrowserError)
    expect(error).toMatchObject({ code: 'BROWSER_UNSUPPORTED', missing: ['opfs-writable'] })
    expect(() => fileManager.getFsSync()).toThrow('File system not initialized')
  })
})

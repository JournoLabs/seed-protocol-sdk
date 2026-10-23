import { afterEach, describe, expect, it } from 'vitest'
import { checkBrowserSupport } from '@/helpers/browserSupport'
import { UnsupportedBrowserError } from '@/helpers/FileManager/errors'
import { BrowserFileManager } from '@/browser/helpers/FileManager'

const isBrowser = typeof window !== 'undefined'

describe.skipIf(isBrowser)('checkBrowserSupport outside a browser', () => {
  it('reports the file system features missing', () => {
    // Node 24 has navigator.locks, so web-locks may not be listed.
    const { supported, missing } = checkBrowserSupport()
    expect(supported).toBe(false)
    expect(missing).toEqual(expect.arrayContaining(['opfs', 'opfs-writable', 'cross-origin-isolation']))
  })
})

describe.skipIf(!isBrowser)('checkBrowserSupport', () => {
  const createWritable = isBrowser
    ? Object.getOwnPropertyDescriptor(FileSystemFileHandle.prototype, 'createWritable')!
    : undefined

  afterEach(() => {
    Object.defineProperty(FileSystemFileHandle.prototype, 'createWritable', createWritable!)
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

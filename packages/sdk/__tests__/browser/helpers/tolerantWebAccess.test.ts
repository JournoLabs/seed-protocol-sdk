import { describe, expect, it } from 'vitest'
import { WebAccessFS } from '@zenfs/dom'
import { TolerantWebAccess, TolerantWebAccessFS } from '@/browser/helpers/tolerantWebAccess'

/** Minimal in-memory stand-ins for OPFS handles; getFile/entries can be made to throw. */
type FakeFile = {
  kind: 'file'
  name: string
  getFile: () => Promise<{ size: number; lastModified: number; arrayBuffer: () => Promise<ArrayBuffer> }>
}
type FakeDir = {
  kind: 'directory'
  name: string
  entries: () => AsyncIterableIterator<[string, FakeFile | FakeDir]>
  keys: () => AsyncIterableIterator<string>
}

function file(name: string, size: number, fail?: () => DOMException | Error | undefined): FakeFile {
  return {
    kind: 'file',
    name,
    getFile: async () => {
      const error = fail?.()
      if (error) throw error
      return { size, lastModified: 1, arrayBuffer: async () => new ArrayBuffer(size) }
    },
  }
}

function dir(name: string, children: (FakeFile | FakeDir)[], fail?: () => DOMException | undefined): FakeDir {
  return {
    kind: 'directory',
    name,
    async *entries() {
      const error = fail?.()
      if (error) throw error
      for (const child of children) yield [child.name, child]
    },
    async *keys() {
      for (const child of children) yield child.name
    },
  }
}

const domError = (name: string) => () => new DOMException(`fake ${name}`, name)

async function mount(root: FakeDir): Promise<TolerantWebAccessFS> {
  return (await TolerantWebAccess.create({ handle: root as unknown as FileSystemDirectoryHandle })) as TolerantWebAccessFS
}

describe('TolerantWebAccess', () => {
  it('still overrides the @zenfs/dom internals it depends on', () => {
    // If an upgrade renames these, the overrides silently stop applying.
    expect(typeof (WebAccessFS.prototype as any)._loadHandles).toBe('function')
    expect(typeof (WebAccessFS.prototype as any)._loadMetadata).toBe('function')
    expect(typeof (WebAccessFS.prototype as any).crossCopy).toBe('function')
    // touch() calls the Async mixin's touch under WebAccessFS's own.
    expect(typeof Object.getPrototypeOf(WebAccessFS.prototype).touch).toBe('function')
    expect(Object.getPrototypeOf(TolerantWebAccessFS.prototype)).toBe(WebAccessFS.prototype)
  })

  // Real OPFS: this file also runs in Node with the fake handles above.
  it.skipIf(typeof window === 'undefined')('caches a directory another context made after the mount, so files can be created in it', async () => {
    const opfs = await navigator.storage.getDirectory()
    const name = `twa-external-${Math.random().toString(36).slice(2, 10)}`
    const root = await opfs.getDirectoryHandle(name, { create: true })
    try {
      const fs = (await TolerantWebAccess.create({ handle: root })) as TolerantWebAccessFS
      await fs.ready()
      // Made beside the mount, as SQLocal's worker makes `db/` or another tab makes a folder.
      const db = await (await root.getDirectoryHandle('outside', { create: true })).getDirectoryHandle('db', { create: true })
      await (await db.getFileHandle('existing.txt', { create: true })).createWritable().then(async (w) => {
        await w.write('abc')
        await w.close()
      })

      expect((await fs.stat('/outside/db')).mode & 0o170000).toBe(0o040000)
      expect(fs._sync.existsSync('/outside/db')).toBe(true)
      await fs.createFile('/outside/db/new.txt', { mode: 0o644, uid: 0, gid: 0 } as any)
      expect(fs._sync.existsSync('/outside/db/new.txt')).toBe(true)

      expect((await fs.stat('/outside/db/existing.txt')).size).toBe(3)
      expect(fs._sync.statSync('/outside/db/existing.txt').size).toBe(3)
    } finally {
      await opfs.removeEntry(name, { recursive: true }).catch(() => {})
    }
  })

  it('skips a file whose getFile() throws InvalidStateError and indexes it once readable', async () => {
    let locked = true
    const root = dir('', [
      dir('db', [file('seed.db', 42, () => (locked ? new DOMException('locked', 'InvalidStateError') : undefined))]),
      file('readable.txt', 5),
    ])
    const fs = await mount(root)

    expect(fs.index.get('/readable.txt')?.size).toBe(5)
    expect(fs.index.get('/db')).toBeDefined()
    expect(fs.index.get('/db/seed.db')).toBeUndefined()

    locked = false
    expect((await fs.stat('/db/seed.db')).size).toBe(42)
  })

  it('leaves a file that becomes unreadable out of the sync cache instead of failing ready()', async () => {
    let busy = false
    const fs = await mount(
      dir('', [file('seed.db', 42, () => (busy ? new DOMException('busy', 'InvalidStateError') : undefined)), file('ok.txt', 3)]),
    )
    busy = true
    await fs.ready()
    expect(fs._sync.existsSync('/ok.txt')).toBe(true)
    expect(fs._sync.existsSync('/seed.db')).toBe(false)
  })

  it('leaves a file that shrank since the walk out of the sync cache', async () => {
    let size = 4096
    const growing: FakeFile = {
      kind: 'file',
      name: 'seed.db',
      getFile: async () => ({ size, lastModified: 1, arrayBuffer: async () => new ArrayBuffer(size) }),
    }
    const fs = await mount(dir('', [growing]))
    size = 100
    await fs.ready()
    expect(fs._sync.existsSync('/seed.db')).toBe(false)
  })

  it('invalidate() re-reads a file another tab rewrote, and forgets one it removed', async () => {
    let size = 3
    const children: (FakeFile | FakeDir)[] = []
    const rewritten: FakeFile = {
      kind: 'file',
      name: 'a.txt',
      getFile: async () => ({ size, lastModified: 1, arrayBuffer: async () => new ArrayBuffer(size) }),
    }
    children.push(rewritten, file('gone.txt', 2))
    const root: FakeDir = {
      kind: 'directory',
      name: '',
      async *entries() {
        for (const child of children) yield [child.name, child]
      },
      async *keys() {
        for (const child of children) yield child.name
      },
      // invalidate() drops the cached handle, so lookups go back to the directory.
      ...({
        getFileHandle: async (name: string) => {
          const found = children.find((child) => child.name === name)
          if (!found) throw new DOMException('gone', 'NotFoundError')
          return found
        },
        getDirectoryHandle: async () => {
          throw new DOMException('not a directory', 'TypeMismatchError')
        },
      } as object),
    }
    const fs = await mount(root)
    await fs.ready()
    expect(fs.index.get('/a.txt')?.size).toBe(3)

    size = 10
    children.splice(1, 1)
    await fs.invalidate('/a.txt')
    await fs.invalidate('/gone.txt')

    expect(fs.index.get('/a.txt')?.size).toBe(10)
    expect(fs._sync.statSync('/a.txt').size).toBe(10)
    expect(fs.index.get('/gone.txt')).toBeUndefined()
    expect(fs._sync.existsSync('/gone.txt')).toBe(false)
  })

  it('forgets a file removed between listing and getFile()', async () => {
    const fs = await mount(dir('', [file('seed.db-journal', 512, domError('NotFoundError'))]))
    expect(fs.index.get('/seed.db-journal')).toBeUndefined()
    expect((fs as any)._handles.has('/seed.db-journal')).toBe(false)
  })

  it('skips a directory removed mid-walk, with everything under it', async () => {
    const fs = await mount(
      dir('', [dir('gone', [file('a.txt', 1)], domError('NotFoundError')), file('kept.txt', 2)]),
    )
    expect(fs.index.get('/gone')).toBeUndefined()
    expect((fs as any)._handles.has('/gone')).toBe(false)
    expect(fs.index.get('/kept.txt')?.size).toBe(2)
  })

  it('still fails the mount when the root itself cannot be listed', async () => {
    await expect(mount(dir('', [], domError('InvalidStateError')))).rejects.toMatchObject({
      name: 'InvalidStateError',
    })
  })

  it('still fails the mount on errors that are not about a busy entry', async () => {
    await expect(mount(dir('', [file('bad', 1, () => new TypeError('boom'))]))).rejects.toThrow('boom')
  })
})

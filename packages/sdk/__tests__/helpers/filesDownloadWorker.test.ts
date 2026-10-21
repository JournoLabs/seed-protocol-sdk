import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import filesDownload from '@/browser/workers/filesDownload'
import { encodeCompositeUpload } from '@/helpers/compositeUpload'
import { contentSha256TagMatches, getContentSha256 } from '@/helpers/arweaveContentTags'
import { sha3_256 } from '@noble/hashes/sha3'
import { bytesToHex } from '@noble/hashes/utils'

const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const PREFERRED = 'https://app.example.com/api/seed-gateway'
const HOST = 'https://arweave.net'

type Posted = {
  message?: string
  transactionId?: string
  filePath?: string
  done?: boolean
  error?: { name: string; message: string }
}

/**
 * Runs the worker source in this realm with a fake OPFS, then sends it one message.
 * Returns what it saved (by file name) and what it posted back.
 */
async function runWorker(
  data: Record<string, unknown>,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  opfs: {
    /** By file name, or by path under the OPFS root (`files/html/<name>`) to make it listable. */
    existing?: Record<string, string>
    failWrite?: boolean | ((name: string) => boolean)
    /** Files from an earlier run, by name; this run reads and writes the same map. */
    shared?: OpfsFiles
  } = {},
): Promise<{
  saved: Map<string, string>
  raw: Map<string, Uint8Array>
  posted: Posted[]
  fetched: string[]
  closed: string[]
}> {
  const encoder = new TextEncoder()
  const files = opfs.shared ?? newOpfsFiles()
  const bytes = files.bytes
  for (const [key, text] of Object.entries(opfs.existing ?? {})) {
    const segments = key.split('/')
    const name = segments.pop()!
    bytes.set(name, encoder.encode(text))
    if (segments.length) files.dirOf.set(name, segments.join('/'))
  }
  const posted: Posted[] = []
  const fetched: string[] = []
  const closed: string[] = []

  // Byte-level stand-in for FileSystemSyncAccessHandle: write() overwrites in place, so stale
  // trailing bytes survive unless the file is truncated first. Files are kept by name; the
  // directory each one was written to is tracked for lookups without `create` and for listing.
  const notFound = () => new DOMException('not found', 'NotFoundError')
  const fileHandle = (name: string): any => ({
    kind: 'file',
    name,
    getFile: async () => ({ size: (bytes.get(name) ?? new Uint8Array()).length }),
    createSyncAccessHandle: async () => ({
      truncate: (size: number) => bytes.set(name, (bytes.get(name) ?? new Uint8Array()).slice(0, size)),
      write: (buf: Uint8Array, { at = 0 }: { at?: number } = {}) => {
        if (typeof opfs.failWrite === 'function' ? opfs.failWrite(name) : opfs.failWrite) {
          throw new DOMException('disk full', 'QuotaExceededError')
        }
        const current = bytes.get(name) ?? new Uint8Array()
        const next = new Uint8Array(Math.max(current.length, at + buf.length))
        next.set(current)
        next.set(buf, at)
        bytes.set(name, next)
        return buf.length
      },
      flush: () => {},
      close: () => closed.push(name),
    }),
  })
  const dirHandle = (path: string): any => ({
    kind: 'directory',
    getDirectoryHandle: async (segment: string, options?: { create?: boolean }) => {
      const child = path ? `${path}/${segment}` : segment
      const known = [...files.dirOf.values()].some((d) => d === child || d.startsWith(`${child}/`))
      if (!options?.create && !known && !files.dirs.has(child)) throw notFound()
      files.dirs.add(child)
      return dirHandle(child)
    },
    getFileHandle: async (name: string, options?: { create?: boolean }) => {
      if (options?.create) {
        if (!files.dirOf.has(name)) files.dirOf.set(name, path)
      } else if (!bytes.has(name) || files.dirOf.get(name) !== path) {
        throw notFound()
      }
      return fileHandle(name)
    },
    values: async function* () {
      for (const [name, dir] of files.dirOf) if (dir === path && bytes.has(name)) yield fileHandle(name)
    },
  })
  const dir = dirHandle('')

  vi.stubGlobal('navigator', { storage: { getDirectory: async () => dir } })
  vi.stubGlobal('postMessage', (m: Posted & { requestId?: number; bytes?: ArrayBuffer; expected?: string }) => {
    posted.push(m)
    // Play the page's part of content verification (FileDownloader runs contentSha256TagMatches).
    if (m.message === 'verifyContent') {
      const ok = contentSha256TagMatches(new Uint8Array(m.bytes!), m.expected!)
      queueMicrotask(() =>
        (globalThis as any).onmessage({ data: { message: 'verifyContentResult', requestId: m.requestId, ok } }),
      )
    }
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      fetched.push(String(url))
      return fetchImpl(String(url), init)
    }),
  )

  // The worker source assigns the global `onmessage`.
  new Function(filesDownload)()
  const onmessage = (globalThis as any).onmessage as (e: { data: unknown }) => Promise<void>
  try {
    await onmessage({ data: { debug: true, filesRoot: '/files', ...data } })
  } finally {
    // Captured here too, so a test can inspect what a failing run left behind.
    lastClosed = closed
  }

  const decoder = new TextDecoder()
  const saved = new Map([...bytes].map(([name, buf]) => [name, decoder.decode(buf)] as [string, string]))
  return { saved, raw: bytes, posted, fetched, closed }
}

let lastClosed: string[] = []

type OpfsFiles = { bytes: Map<string, Uint8Array>; dirOf: Map<string, string>; dirs: Set<string> }
const newOpfsFiles = (): OpfsFiles => ({ bytes: new Map(), dirOf: new Map(), dirs: new Set() })

describe.skipIf(typeof window !== 'undefined')('filesDownload worker', () => {
  beforeEach(() => {
    delete (globalThis as any).onmessage
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as any).onmessage
  })

  it('reads from the preferred gateway first and skips the configured host', async () => {
    const { saved, fetched } = await runWorker(
      { transactionIds: [TX], arweaveHost: HOST, arweaveBaseUrls: [PREFERRED, HOST] },
      async (url) =>
        url.startsWith(PREFERRED)
          ? new Response('<p>fresh</p>', { status: 200 })
          : new Response('', { status: 404 }),
    )

    expect(fetched).toEqual([`${PREFERRED}/raw/${TX}`])
    expect(saved.get(`${TX}.html`)).toBe('<p>fresh</p>')
  })

  it('does not save a non-2xx body, and does not exclude the transaction', async () => {
    const { saved, posted } = await runWorker(
      { transactionIds: [TX], arweaveHost: HOST, arweaveBaseUrls: [PREFERRED] },
      async () => new Response('<html>Not Found</html>', { status: 404 }),
    )

    expect(saved.size).toBe(0)
    expect(posted.some((m) => m.message === 'excludeTransaction')).toBe(false)
    expect(posted.some((m) => m.done)).toBe(true)
  })

  it('falls through a network error to the next gateway', async () => {
    const { saved } = await runWorker(
      { transactionIds: [TX], arweaveHost: HOST, arweaveBaseUrls: [PREFERRED] },
      async (url) => {
        if (url.startsWith(PREFERRED)) throw new TypeError('Failed to fetch')
        return new Response('{"a":1}', { status: 200 })
      },
    )

    expect(saved.get(`${TX}.json`)).toBe('{"a":1}')
  })

  it('excludes the transaction only when no gateway answered', async () => {
    const { saved, posted } = await runWorker(
      { transactionIds: [TX], arweaveHost: HOST, arweaveBaseUrls: [PREFERRED] },
      async () => {
        throw new TypeError('Failed to fetch')
      },
    )

    expect(saved.size).toBe(0)
    expect(posted).toContainEqual({ message: 'excludeTransaction', transactionId: TX })
  })

  it('overwrites a longer existing file without leaving its trailing bytes', async () => {
    const { saved } = await runWorker(
      { transactionIds: [TX], arweaveHost: HOST },
      async () => new Response('{"a":1}', { status: 200 }),
      { existing: { [`${TX}.json`]: '{"previous":"and much longer"}' } },
    )

    expect(saved.get(`${TX}.json`)).toBe('{"a":1}')
  })

  it('closes the sync access handle when the write fails, reports the file and still finishes', async () => {
    const { posted } = await runWorker(
      { transactionIds: [TX], arweaveHost: HOST },
      async () => new Response('{"a":1}', { status: 200 }),
      { failWrite: true },
    )

    expect(lastClosed).toEqual([`${TX}.json`])
    expect(posted).toContainEqual({
      message: 'fileError',
      transactionId: TX,
      error: { name: 'QuotaExceededError', message: 'disk full' },
    })
    expect(posted.at(-1)).toMatchObject({ done: true })
  })

  it('one failing file does not stop the rest of the batch', async () => {
    const TX2 = 'A'.repeat(43)
    const { saved, posted } = await runWorker(
      { transactionIds: [TX, TX2], arweaveHost: HOST },
      async (url) => new Response(url.includes(TX2) ? '{"b":2}' : '{"a":1}', { status: 200 }),
      { failWrite: (name) => name.startsWith(TX) },
    )

    expect(saved.get(`${TX2}.json`)).toBe('{"b":2}')
    expect(posted.filter((m) => m.message === 'fileError').map((m) => m.transactionId)).toEqual([TX])
    expect(posted.filter((m) => m.message === 'fileProcessed').map((m) => m.transactionId)).toEqual([TX, TX2])
    expect(posted.at(-1)).toMatchObject({ done: true })
  })

  it('gives up on a gateway that never answers and tries the next one', async () => {
    vi.useFakeTimers()
    try {
      const run = runWorker(
        { transactionIds: [TX], arweaveHost: HOST, arweaveBaseUrls: [PREFERRED] },
        (url, init) =>
          url.startsWith(PREFERRED)
            ? new Promise<Response>((_, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
              })
            : Promise.resolve(new Response('{"a":1}', { status: 200 })),
      )
      await vi.advanceTimersByTimeAsync(60_000)
      const { saved, posted } = await run
      expect(saved.get(`${TX}.json`)).toBe('{"a":1}')
      expect(posted.at(-1)).toMatchObject({ done: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('posts an error instead of done when the batch itself throws', async () => {
    // A malformed job (no transaction list) fails outside the per-file handling.
    const { posted } = await runWorker({ transactionIds: undefined, arweaveHost: HOST }, async () =>
      new Response('', { status: 404 }),
    )

    expect(posted.some((m) => m.done)).toBe(false)
    expect(posted.at(-1)).toMatchObject({ message: 'filesDownload failed', error: { name: 'TypeError' } })
  })

  describe('where content lands', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    const BINARY = new Uint8Array(64).map((_, i) => (i * 37 + 200) % 256)

    const savedPaths = async (body: BodyInit, headers?: Record<string, string>) => {
      const { posted } = await runWorker({ transactionIds: [TX], arweaveHost: HOST }, async () =>
        new Response(body, { status: 200, headers }),
      )
      return posted.filter((m) => m.message === 'fileSaved').map((m) => m.filePath)
    }

    it('declared image Content-Type goes to images/', async () => {
      expect(await savedPaths(PNG, { 'content-type': 'image/png' })).toEqual([`/files/images/${TX}`])
      expect(await savedPaths('<svg xmlns="http://www.w3.org/2000/svg"></svg>', { 'content-type': 'image/svg+xml' })).toEqual([
        `/files/images/${TX}`,
      ])
    })

    it('declared non-image Content-Type goes to files/, never images/', async () => {
      expect(await savedPaths(BINARY, { 'content-type': 'application/pdf' })).toEqual([`/files/files/${TX}.pdf`])
      expect(await savedPaths(BINARY, { 'content-type': 'video/x-unknown' })).toEqual([`/files/files/${TX}`])
      // Extensions come from the map shared with the upload side (helpers/mimeTypes.ts).
      expect(await savedPaths(BINARY, { 'content-type': 'video/quicktime' })).toEqual([`/files/files/${TX}.mov`])
      expect(await savedPaths(BINARY, { 'content-type': 'audio/x-wav' })).toEqual([`/files/files/${TX}.wav`])
      expect(await savedPaths(BINARY, { 'content-type': 'audio/mpeg' })).toEqual([`/files/files/${TX}.mp3`])
      expect(await savedPaths('# Title\n\n- item', { 'content-type': 'text/markdown; charset=utf-8' })).toEqual([
        `/files/files/${TX}.md`,
      ])
    })

    it('declared html / json Content-Types', async () => {
      expect(await savedPaths('{"a":1}', { 'content-type': 'application/json' })).toEqual([`/files/json/${TX}.json`])
      expect(await savedPaths('<p>x</p>', { 'content-type': 'text/html; charset=utf-8' })).toEqual([`/files/html/${TX}.html`])
    })

    it('generic Content-Type: binary is an image only with an image signature', async () => {
      expect(await savedPaths(PNG, { 'content-type': 'application/octet-stream' })).toEqual([`/files/images/${TX}`])
      expect(await savedPaths(BINARY, { 'content-type': 'application/octet-stream' })).toEqual([`/files/files/${TX}`])
      expect(await savedPaths(BINARY)).toEqual([`/files/files/${TX}`])
    })

    // The worker used its own image-signature check; it now uses helpers/mimeTypes.ts sniffMimeType.
    it('generic Content-Type: ICO is an image, a 3-byte "BM" file is not', async () => {
      const ICO = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0, 0, 1, 0, 32, 0, 0x68, 0x04])
      expect(await savedPaths(ICO, { 'content-type': 'application/octet-stream' })).toEqual([`/files/images/${TX}`])
      expect(await savedPaths(new Uint8Array([0x42, 0x4d, 0xff]), { 'content-type': 'application/octet-stream' })).toEqual([
        `/files/files/${TX}`,
      ])
    })

    it('generic Content-Type: plain text goes to files/, not images/', async () => {
      // Matches the bare-base64 pattern; it used to be base64-decoded into images/.
      // (A string body gets `text/plain;charset=UTF-8`, hence .txt.)
      expect(await savedPaths('hello')).toEqual([`/files/files/${TX}.txt`])
      expect(await savedPaths('just some words here')).toEqual([`/files/files/${TX}.txt`])
      expect(await savedPaths(new TextEncoder().encode('hello'))).toEqual([`/files/files/${TX}`])
    })

    it('text that looks like a non-image URL is kept instead of failing the download', async () => {
      const { posted } = await runWorker({ transactionIds: [TX], arweaveHost: HOST }, async () =>
        new Response('example.com/readme', { status: 200 }),
      )
      expect(posted.filter((m) => m.message === 'fileSaved').map((m) => m.filePath)).toEqual([`/files/files/${TX}.txt`])
      expect(posted.some((m) => m.done)).toBe(true)
    })

    it('a data:image URI is still decoded into images/', async () => {
      const b64 = btoa(String.fromCharCode(...PNG))
      expect(await savedPaths(`data:image/png;base64,${b64}`)).toEqual([`/files/images/${TX}.png`])
    })
  })

  describe('composite uploads', () => {
    const runComposite = async (body: Uint8Array) =>
      runWorker({ transactionIds: [TX], arweaveHost: HOST }, async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      )

    it('decodes what the SDK encoder writes, binary children included', async () => {
      const html = '<p>héllo</p>'
      const json = new Uint8Array([0x7b, 0x7d, 0x00, 0xff]) // not valid text: base64-framed
      const body = encodeCompositeUpload([
        { name: 'html', bytes: new TextEncoder().encode(html) },
        { name: 'json', bytes: json },
      ])
      const { raw, posted } = await runWorker({ transactionIds: [TX], arweaveHost: HOST }, async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
      )
      expect(posted.filter((m) => m.message === 'fileSaved').map((m) => m.filePath)).toEqual([
        `/files/html/${TX}.html`,
        `/files/json/${TX}.json`,
      ])
      expect(new TextDecoder().decode(raw.get(`${TX}.html`))).toBe(html)
      expect(Array.from(raw.get(`${TX}.json`)!)).toEqual(Array.from(json))
    })

    it('still reads a legacy text composite', async () => {
      const legacy = new TextEncoder().encode(
        '===FILE_SEPARATOR===html===FILE_SEPARATOR===<h1>t</h1>===FILE_SEPARATOR===json===FILE_SEPARATOR===' +
          '{"b":2}',
      )
      const { posted } = await runComposite(legacy)
      expect(posted.filter((m) => m.message === 'fileSaved').map((m) => m.filePath)).toEqual([
        `/files/html/${TX}.html`,
        `/files/json/${TX}.json`,
      ])
    })

    describe('children routed by the model\'s ItemStorage settings', () => {
      const cover = new Uint8Array(64).map((_, i) => 255 - i) // binary: base64-framed
      const body = () =>
        encodeCompositeUpload([
          { name: 'html', bytes: new TextEncoder().encode('<p>post</p>') },
          { name: 'cover', bytes: cover },
          { name: 'notes', bytes: new TextEncoder().encode('# notes') },
        ])
      const run = (compositeChildPaths?: Record<string, Record<string, string>>) =>
        runWorker({ transactionIds: [TX], arweaveHost: HOST, compositeChildPaths }, async () =>
          new Response(body(), { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
        )
      const savedTo = (posted: Posted[]) =>
        posted.filter((m) => m.message === 'fileSaved').map((m) => m.filePath)

      it('saves every child where the SDK reads that property (storage dir + txId + extension)', async () => {
        const { raw, posted } = await run({
          [TX]: { html: `html/${TX}.html`, cover: `covers/${TX}.bin`, notes: `notes/${TX}.md` },
        })
        expect(savedTo(posted)).toEqual([
          `/files/html/${TX}.html`,
          `/files/covers/${TX}.bin`,
          `/files/notes/${TX}.md`,
        ])
        expect(Array.from(raw.get(`${TX}.bin`)!)).toEqual(Array.from(cover))
        expect(new TextDecoder().decode(raw.get(`${TX}.md`))).toBe('# notes')
        expect(posted.some((m) => m.message === 'compositeChildUnrouted')).toBe(false)
      })

      it('without paths: html / json as before, other children reported instead of guessed at', async () => {
        const { posted } = await run()
        expect(savedTo(posted)).toEqual([`/files/html/${TX}.html`])
        expect(
          posted.filter((m) => m.message === 'compositeChildUnrouted').map((m) => (m as any).name),
        ).toEqual(['cover', 'notes'])
      })

      it('paths for another transaction do not apply', async () => {
        const { posted } = await run({ ['x'.repeat(43)]: { cover: 'files/other.bin' } })
        expect(savedTo(posted)).toEqual([`/files/html/${TX}.html`])
      })

      it('ignores a path that is absolute or climbs out of the files root', async () => {
        const { posted } = await run({
          [TX]: { cover: '../outside.bin', notes: '/etc/notes.md', html: `html/${TX}.html` },
        })
        expect(savedTo(posted)).toEqual([`/files/html/${TX}.html`])
        expect(
          posted.filter((m) => m.message === 'compositeChildUnrouted').map((m) => (m as any).name),
        ).toEqual(['cover', 'notes'])
      })
    })

    it('a composite of mostly non-ASCII text is still recognised', async () => {
      const cjk = '<p>' + '你好世界'.repeat(200) + '</p>'
      const body = new TextEncoder().encode(`===FILE_SEPARATOR===html===FILE_SEPARATOR===${cjk}`)
      const { saved } = await runComposite(body)
      expect(saved.get(`${TX}.html`)).toBe(cjk)
    })
  })

  describe('Content-SHA-256 verification', () => {
    const BODY = '{"verified":true}'
    const BYTES = new TextEncoder().encode(BODY)
    const sha256 = getContentSha256(BYTES)
    const messages = (posted: Posted[], message: string) =>
      posted.filter((m) => m.message === message).map((m) => m.transactionId)

    it('saves bytes matching the SHA-256 tag (checked in the worker, no round trip)', async () => {
      const { saved, posted } = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, expectedContentHashes: { [TX]: sha256.toUpperCase() } },
        async () => new Response(BODY, { status: 200 }),
      )
      expect(saved.get(`${TX}.json`)).toBe(BODY)
      expect(messages(posted, 'contentVerified')).toEqual([TX])
      expect(messages(posted, 'verifyContent')).toEqual([])
    })

    it('accepts a legacy SHA3-256 tag through the page', async () => {
      const { saved, posted } = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, expectedContentHashes: { [TX]: bytesToHex(sha3_256(BYTES)) } },
        async () => new Response(BODY, { status: 200 }),
      )
      expect(saved.get(`${TX}.json`)).toBe(BODY)
      expect(messages(posted, 'verifyContent')).toEqual([TX])
      expect(messages(posted, 'contentVerified')).toEqual([TX])
    })

    it('skips a gateway serving the wrong bytes and takes the next one', async () => {
      const { saved, fetched } = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, arweaveBaseUrls: [PREFERRED], expectedContentHashes: { [TX]: sha256 } },
        async (url) =>
          new Response(url.startsWith(PREFERRED) ? '<html>gateway error page</html>' : BODY, { status: 200 }),
      )
      expect(fetched).toEqual([`${PREFERRED}/raw/${TX}`, `${HOST}/raw/${TX}`])
      expect(saved.get(`${TX}.json`)).toBe(BODY)
      expect(saved.has(`${TX}.html`)).toBe(false)
    })

    it('saves nothing when no gateway serves matching bytes, and does not exclude the transaction', async () => {
      const { saved, posted } = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, expectedContentHashes: { [TX]: 'ab'.repeat(32) } },
        async () => new Response(BODY, { status: 200 }),
      )
      expect(saved.size).toBe(0)
      expect(messages(posted, 'contentHashMismatch')).toEqual([TX])
      expect(messages(posted, 'excludeTransaction')).toEqual([])
      expect(posted.at(-1)).toMatchObject({ done: true })
    })

    it('a transaction without a tag is saved unverified', async () => {
      const TX2 = 'B'.repeat(43)
      const { saved, posted } = await runWorker(
        { transactionIds: [TX, TX2], arweaveHost: HOST, expectedContentHashes: { [TX]: sha256 } },
        async () => new Response(BODY, { status: 200 }),
      )
      expect(saved.get(`${TX}.json`)).toBe(BODY)
      expect(saved.get(`${TX2}.json`)).toBe(BODY)
      expect(messages(posted, 'contentVerified')).toEqual([TX])
    })
  })

  it('still works with only arweaveHost (no base URL list)', async () => {
    const { fetched } = await runWorker(
      { transactionIds: [TX], arweaveHost: 'arweave.net' },
      async () => new Response('<p>x</p>', { status: 200 }),
    )

    expect(fetched).toEqual([`https://arweave.net/raw/${TX}`])
  })

  /** Audit V10 (G21-2): a bulk run used to fetch, write and announce every file again. */
  describe('skipExisting', () => {
    const TX_B = 'B'.repeat(43)
    const TX_C = 'C'.repeat(43)
    const respond = async (url: string) =>
      url.endsWith(TX_B)
        ? new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]) as BodyInit, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          })
        : url.endsWith(TX_C)
          ? new Response('{"c":3}', { status: 200 })
          : new Response('<p>a</p>', { status: 200 })
    const savedPaths = (posted: Posted[]) =>
      posted.filter((m) => m.message === 'fileSaved').map((m) => m.filePath)
    const nextRun = () => {
      vi.unstubAllGlobals()
      delete (globalThis as any).onmessage
    }

    it('a second run with every file on disk fetches and writes nothing', async () => {
      const shared = newOpfsFiles()
      const data = { transactionIds: [TX, TX_B, TX_C], arweaveHost: HOST, skipExisting: true }

      const first = await runWorker(data, respond, { shared })
      expect(first.fetched).toHaveLength(3)
      expect(savedPaths(first.posted)).toEqual([
        `/files/html/${TX}.html`,
        `/files/images/${TX_B}`,
        `/files/json/${TX_C}.json`,
      ])

      nextRun()
      const second = await runWorker(data, respond, { shared })
      expect(second.fetched).toEqual([])
      expect(savedPaths(second.posted)).toEqual([])
      expect(second.closed).toEqual([])
      // Still one liveness signal per transaction, and done.
      expect(second.posted.filter((m) => m.message === 'fileProcessed').map((m) => m.transactionId))
        .toEqual([TX, TX_B, TX_C])
      expect(second.posted.at(-1)).toMatchObject({ done: true })
    })

    it('downloads only the transactions without a file', async () => {
      const { fetched } = await runWorker(
        { transactionIds: [TX, TX_B, TX_C], arweaveHost: HOST, skipExisting: true },
        respond,
        // Legacy data:image download (images/<txId>.<ext>) counts too.
        { existing: { [`files/html/${TX}.html`]: '<p>a</p>', [`files/images/${TX_B}.png`]: 'png' } },
      )
      expect(fetched).toEqual([`${HOST}/raw/${TX_C}`])
    })

    it('an empty file is downloaded again', async () => {
      const { fetched, saved } = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, skipExisting: true },
        respond,
        { existing: { [`files/html/${TX}.html`]: '' } },
      )
      expect(fetched).toEqual([`${HOST}/raw/${TX}`])
      expect(saved.get(`${TX}.html`)).toBe('<p>a</p>')
    })

    it('a file with the same name in another directory does not count', async () => {
      const { fetched } = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, skipExisting: true },
        respond,
        { existing: { [`files/other/${TX}.html`]: '<p>a</p>' } },
      )
      expect(fetched).toEqual([`${HOST}/raw/${TX}`])
    })

    it('without skipExisting, files on disk are fetched and written again', async () => {
      const { fetched, posted } = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST },
        respond,
        { existing: { [`files/html/${TX}.html`]: '<p>a</p>' } },
      )
      expect(fetched).toEqual([`${HOST}/raw/${TX}`])
      expect(savedPaths(posted)).toEqual([`/files/html/${TX}.html`])
    })

    it('a composite counts as stored only when every routed child is on disk', async () => {
      const composite = async () =>
        new Response(
          encodeCompositeUpload([
            { name: 'html', bytes: new TextEncoder().encode('<p>post</p>') },
            { name: 'notes', bytes: new TextEncoder().encode('# notes') },
          ]) as BodyInit,
          { status: 200, headers: { 'content-type': 'application/octet-stream' } },
        )
      const shared = newOpfsFiles()

      // Before sync knows the notes property: html/ fallback only, notes unrouted.
      const first = await runWorker({ transactionIds: [TX], arweaveHost: HOST, skipExisting: true }, composite, { shared })
      expect(savedPaths(first.posted)).toEqual([`/files/html/${TX}.html`])

      // Now routed: notes is missing, so the composite is fetched again and placed.
      const compositeChildPaths = { [TX]: { html: `html/${TX}.html`, notes: `notes/${TX}.md` } }
      nextRun()
      const second = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, skipExisting: true, compositeChildPaths },
        composite,
        { shared },
      )
      expect(savedPaths(second.posted)).toEqual([`/files/html/${TX}.html`, `/files/notes/${TX}.md`])

      nextRun()
      const third = await runWorker(
        { transactionIds: [TX], arweaveHost: HOST, skipExisting: true, compositeChildPaths },
        composite,
        { shared },
      )
      expect(third.fetched).toEqual([])
      expect(savedPaths(third.posted)).toEqual([])
    })
  })
})

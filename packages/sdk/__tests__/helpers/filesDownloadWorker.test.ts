import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import filesDownload from '@/browser/workers/filesDownload'

const TX = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
const PREFERRED = 'https://app.example.com/api/seed-gateway'
const HOST = 'https://arweave.net'

type Posted = { message?: string; transactionId?: string; done?: boolean }

/**
 * Runs the worker source in this realm with a fake OPFS, then sends it one message.
 * Returns what it saved (by file name) and what it posted back.
 */
async function runWorker(
  data: Record<string, unknown>,
  fetchImpl: (url: string) => Promise<Response>,
  opfs: { existing?: Record<string, string>; failWrite?: boolean } = {},
): Promise<{ saved: Map<string, string>; posted: Posted[]; fetched: string[]; closed: string[] }> {
  const encoder = new TextEncoder()
  const bytes = new Map<string, Uint8Array>(
    Object.entries(opfs.existing ?? {}).map(([name, text]) => [name, encoder.encode(text)]),
  )
  const posted: Posted[] = []
  const fetched: string[] = []
  const closed: string[] = []

  // Byte-level stand-in for FileSystemSyncAccessHandle: write() overwrites in place, so stale
  // trailing bytes survive unless the file is truncated first.
  const dir: any = {
    getDirectoryHandle: async () => dir,
    getFileHandle: async (name: string) => ({
      createSyncAccessHandle: async () => ({
        truncate: (size: number) => bytes.set(name, (bytes.get(name) ?? new Uint8Array()).slice(0, size)),
        write: (buf: Uint8Array, { at = 0 }: { at?: number } = {}) => {
          if (opfs.failWrite) throw new DOMException('disk full', 'QuotaExceededError')
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
    }),
  }

  vi.stubGlobal('navigator', { storage: { getDirectory: async () => dir } })
  vi.stubGlobal('postMessage', (m: Posted) => posted.push(m))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      fetched.push(String(url))
      return fetchImpl(String(url))
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
  return { saved, posted, fetched, closed }
}

let lastClosed: string[] = []

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

  it('closes the sync access handle when the write fails', async () => {
    await expect(
      runWorker(
        { transactionIds: [TX], arweaveHost: HOST },
        async () => new Response('{"a":1}', { status: 200 }),
        { failWrite: true },
      ),
    ).rejects.toMatchObject({ name: 'QuotaExceededError' })

    expect(lastClosed).toEqual([`${TX}.json`])
  })

  it('still works with only arweaveHost (no base URL list)', async () => {
    const { fetched } = await runWorker(
      { transactionIds: [TX], arweaveHost: 'arweave.net' },
      async () => new Response('<p>x</p>', { status: 200 }),
    )

    expect(fetched).toEqual([`https://arweave.net/raw/${TX}`])
  })
})

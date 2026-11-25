import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BlobStore } from '@seedprotocol/publish'
import { computeCid, IPFS_CID_TAG, ipfsBlobStore, ipfsMirror, kuboRpcPinning, pinataPinning, type PinResult } from '../src'
import { sha256, toHex } from '../src/cid'
import { lcgBytes, startMockIpfs, type MockIpfs } from './fixtures'

type Upload = Parameters<BlobStore['prepare']>[0][number]

const upload = async (name: string, bytes: Uint8Array, contentHash?: string): Promise<Upload> => ({
  blob: new Blob([bytes as Uint8Array<ArrayBuffer>]),
  contentHash: contentHash ?? toHex(await sha256(bytes)),
  tags: [{ name: 'Content-Type', value: 'image/png' }],
  itemPropertyName: name,
  itemPropertyLocalId: `p-${name}`,
  seedLocalId: `s-${name}`,
  versionLocalId: 'v1',
})

let ipfs: MockIpfs
beforeEach(async () => {
  ipfs = await startMockIpfs()
})
afterEach(() => ipfs.close())

const fast = { storedTimeoutMs: 200, pollIntervalMs: 20 }

describe('ipfsBlobStore with a Kubo node', () => {
  it('fixes ipfs:// ids before sending anything, then pins each blob and finds it pinned', async () => {
    const small = new TextEncoder().encode('hello world')
    const large = lcgBytes(600_000, 7)
    const store = ipfsBlobStore({ pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })

    const prepared = await store.prepare([await upload('image', small), await upload('body', large)], {})
    expect(prepared.ids).toEqual([`ipfs://${await computeCid(small)}`, `ipfs://${await computeCid(large)}`])
    expect(ipfs.requests).toEqual([])

    await store.send(prepared.pending!, {})
    expect([...ipfs.pinned]).toEqual(prepared.ids.map((id) => id.slice('ipfs://'.length)))
    await store.assertStored(prepared.ids)
  })

  it('refuses bytes that no longer match the Content-SHA-256', async () => {
    const store = ipfsBlobStore({ pinning: kuboRpcPinning({ url: ipfs.url }) })
    await expect(store.prepare([await upload('image', new Uint8Array([1]), '00'.repeat(32))], {})).rejects.toThrow(
      'changed after the publish read it',
    )
  })

  it('fails the send when Kubo reports a pin error', async () => {
    const store = ipfsBlobStore({ pinning: kuboRpcPinning({ url: ipfs.url }) })
    const prepared = await store.prepare([await upload('image', new Uint8Array([1, 2]))], {})
    ipfs.failNextPin = 'out of space'
    await expect(store.send(prepared.pending!, {})).rejects.toThrow('out of space')
  })

  it('names the blobs that never got pinned', async () => {
    const store = ipfsBlobStore({ pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
    const prepared = await store.prepare([await upload('image', new Uint8Array([3]))], {})
    await expect(store.assertStored(prepared.ids)).rejects.toThrow(prepared.ids[0]!.slice('ipfs://'.length))
  })
})

describe('ipfsBlobStore with Pinata', () => {
  it('uploads a public CAR with the JWT and waits for a gateway to serve it', async () => {
    const store = ipfsBlobStore({
      pinning: pinataPinning({ jwt: 'test-jwt', uploadUrl: `${ipfs.url}/v3/files`, groupId: 'g1' }),
      gateways: [ipfs.url],
      ...fast,
    })
    const prepared = await store.prepare([await upload('image', new Uint8Array([4, 5]))], {})
    const cid = prepared.ids[0]!.slice('ipfs://'.length)
    await store.send(prepared.pending!, {})
    expect(ipfs.pinataUploads).toEqual([
      { fields: { network: 'public', car: 'true', name: cid, group_id: 'g1' }, authorization: 'Bearer test-jwt' },
    ])

    ipfs.gatewayDelay = 2
    await store.assertStored(prepared.ids)
    expect(ipfs.requests.filter((r) => r === `HEAD /ipfs/${cid}`)).toHaveLength(3)
  })

  it('fails when Pinata stores another CID', async () => {
    const store = ipfsBlobStore({ pinning: pinataPinning({ jwt: 'test-jwt', uploadUrl: `${ipfs.url}/v3/files` }) })
    const prepared = await store.prepare([await upload('image', new Uint8Array([6]))], {})
    ipfs.pinataCid = 'bafkreiother'
    await expect(store.send(prepared.pending!, {})).rejects.toThrow('Pinata stored bafkreiother')
  })
})

describe('ipfsMirror', () => {
  /** An inner store that names uploads `inner:<n>` and records what it was given. */
  const recordingStore = () => {
    const seen = { uploads: [] as Upload[], sent: [] as unknown[][], checked: [] as string[][] }
    const store: BlobStore = {
      id: 'arweave',
      usesUploadApi: true,
      prepare: async (uploads) => {
        seen.uploads.push(...uploads)
        return { ids: uploads.map((_, i) => `inner:${i}`), pending: uploads.map((u) => u.itemPropertyName) }
      },
      send: async (pending) => void seen.sent.push(pending),
      assertStored: async (ids) => void seen.checked.push(ids),
    }
    return { store, seen }
  }

  it("attests the wrapped store's ids, tags each upload with its CID and stores both copies", async () => {
    const { store: inner, seen } = recordingStore()
    const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
    const bytes = new Uint8Array([7, 8, 9])
    const cid = await computeCid(bytes)

    const prepared = await store.prepare([await upload('image', bytes)], {})
    expect(store.id).toBe('arweave+ipfs')
    expect(prepared.ids).toEqual(['inner:0'])
    expect(seen.uploads[0]!.tags).toEqual([
      { name: 'Content-Type', value: 'image/png' },
      { name: IPFS_CID_TAG, value: cid },
    ])

    await store.send(prepared.pending!, {})
    expect(seen.sent).toEqual([['image']])
    expect([...ipfs.pinned]).toEqual([cid])

    await store.assertStored(prepared.ids)
    expect(seen.checked).toEqual([['inner:0']])
  })

  it("passes the wrapped store's usesUploadApi through; an IPFS-only store doesn't use the upload API", () => {
    const { store: inner } = recordingStore()
    const pinning = kuboRpcPinning({ url: ipfs.url })
    expect(ipfsMirror(inner, { pinning }).usesUploadApi).toBe(true)
    expect(ipfsMirror({ ...inner, usesUploadApi: false }, { pinning }).usesUploadApi).toBe(false)
    expect(ipfsBlobStore({ pinning }).usesUploadApi).toBe(false)
  })

  it('fails the publish when the IPFS copy is not pinned', async () => {
    const { store: inner } = recordingStore()
    const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
    const prepared = await store.prepare([await upload('image', new Uint8Array([10]))], {})
    await expect(store.assertStored(prepared.ids)).rejects.toThrow('IPFS blobs not stored')
  })

  describe('reusable', () => {
    /** The upload a replacing publish would read again, and the id the parked run attested for it. */
    const parked = async (store: BlobStore, bytes: Uint8Array) => {
      const u = await upload('image', bytes)
      return { u, id: (await store.prepare([u], {})).ids[0]! }
    }

    it('pins an upload whose pin never landed, and reuses the id', async () => {
      const { store: inner, seen } = recordingStore()
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
      const bytes = new Uint8Array([21, 22, 23])
      // A restored publish: prepared in an earlier session, nothing sent to IPFS.
      const { u, id } = await parked(store, bytes)
      const fresh = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })

      expect(await fresh.reusable!(id, u)).toBe(true)
      expect([...ipfs.pinned]).toEqual([await computeCid(bytes)])
      expect(seen.checked).toEqual([[id]])
    })

    it('reuses an upload that is already pinned without sending it again', async () => {
      const { store: inner } = recordingStore()
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
      const { u, id } = await parked(store, new Uint8Array([31]))
      expect(await store.reusable!(id, u)).toBe(true)
      const imports = () => ipfs.requests.filter((r) => r.includes('dag/import')).length
      const before = imports()
      expect(await store.reusable!(id, u)).toBe(true)
      expect(imports()).toBe(before)
    })

    it('is false when the local bytes are gone or changed, so the upload is prepared again', async () => {
      const { store: inner } = recordingStore()
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
      const { u, id } = await parked(store, new Uint8Array([41]))
      expect(await store.reusable!(id, { ...u, contentHash: '00'.repeat(32) })).toBe(false)
      expect(ipfs.pinned.size).toBe(0)
    })

    it("is false when the wrapped store no longer holds the id", async () => {
      const { store: inner } = recordingStore()
      inner.assertStored = async () => {
        throw new Error('not on Arweave')
      }
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
      const { u, id } = await parked(store, new Uint8Array([51]))
      expect(await store.reusable!(id, u)).toBe(false)
    })

    it('fails when a required re-pin fails, and reports it', async () => {
      const { store: inner } = recordingStore()
      const results: PinResult[] = []
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), onPinResult: (r) => results.push(r), ...fast })
      const { u, id } = await parked(store, new Uint8Array([61]))
      ipfs.failNextPin = 'out of space'
      await expect(store.reusable!(id, u)).rejects.toThrow('out of space')
      expect(results).toEqual([{ id, cid: await computeCid(new Uint8Array([61])), ok: false, error: expect.anything() }])
    })

    it('reuses the id when a re-pin fails and the copy is not required, and reports it', async () => {
      const { store: inner } = recordingStore()
      const results: PinResult[] = []
      const store = ipfsMirror(inner, {
        pinning: kuboRpcPinning({ url: ipfs.url }),
        required: false,
        onPinResult: (r) => results.push(r),
        ...fast,
      })
      const { u, id } = await parked(store, new Uint8Array([62]))
      ipfs.failNextPin = 'out of space'
      expect(await store.reusable!(id, u)).toBe(true)
      expect(results).toEqual([
        { id, cid: await computeCid(new Uint8Array([62])), ok: false, error: expect.objectContaining({ message: expect.stringContaining('out of space') }) },
      ])
    })

    it('reports a re-pin that lands', async () => {
      const { store: inner } = recordingStore()
      const results: PinResult[] = []
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), onPinResult: (r) => results.push(r), ...fast })
      const bytes = new Uint8Array([63])
      const { u, id } = await parked(store, bytes)
      expect(await store.reusable!(id, u)).toBe(true)
      expect(results).toEqual([{ id, cid: await computeCid(bytes), ok: true }])
    })
  })

  it('reports each id and CID once its pin is confirmed', async () => {
    const { store: inner } = recordingStore()
    const results: PinResult[] = []
    const store = ipfsMirror(inner, {
      pinning: kuboRpcPinning({ url: ipfs.url }),
      onPinResult: (r) => results.push(r),
      ...fast,
    })
    const bytes = new Uint8Array([11, 12])
    const prepared = await store.prepare([await upload('image', bytes)], {})
    await store.send(prepared.pending!, {})
    expect(results).toEqual([])
    await store.assertStored(prepared.ids)
    expect(results).toEqual([{ id: 'inner:0', cid: await computeCid(bytes), ok: true }])
  })

  it('reports a failed pin before failing the publish when the copy is required', async () => {
    const { store: inner } = recordingStore()
    const results: PinResult[] = []
    const store = ipfsMirror(inner, {
      pinning: kuboRpcPinning({ url: ipfs.url }),
      onPinResult: (r) => results.push(r),
      ...fast,
    })
    const prepared = await store.prepare([await upload('image', new Uint8Array([13]))], {})
    ipfs.failNextPin = 'out of space'
    await expect(store.send(prepared.pending!, {})).rejects.toThrow('out of space')
    expect(results).toMatchObject([{ id: 'inner:0', ok: false, error: expect.objectContaining({ message: expect.stringContaining('out of space') }) }])
  })

  it('checks a required copy again when the publish retries', async () => {
    const { store: inner } = recordingStore()
    const results: PinResult[] = []
    const store = ipfsMirror(inner, {
      pinning: kuboRpcPinning({ url: ipfs.url }),
      onPinResult: (r) => results.push(r),
      ...fast,
    })
    const prepared = await store.prepare([await upload('image', new Uint8Array([14]))], {})
    await expect(store.assertStored(prepared.ids)).rejects.toThrow('IPFS blobs not stored')
    await expect(store.assertStored(prepared.ids)).rejects.toThrow('IPFS blobs not stored')
    expect(results.map((r) => r.ok)).toEqual([false, false])
  })

  describe('with required: false', () => {
    it('publishes when a pin upload fails, and reports which ids pinned', async () => {
      const { store: inner, seen } = recordingStore()
      const results: PinResult[] = []
      const store = ipfsMirror(inner, {
        pinning: kuboRpcPinning({ url: ipfs.url }),
        required: false,
        onPinResult: (r) => results.push(r),
        ...fast,
      })
      const first = new Uint8Array([20])
      const second = new Uint8Array([21])
      const prepared = await store.prepare([await upload('image', first), await upload('body', second)], {})
      ipfs.failNextPin = 'out of space'
      await store.send(prepared.pending!, {})
      expect(seen.sent).toEqual([['image', 'body']])
      await store.assertStored(prepared.ids)
      expect(seen.checked).toEqual([['inner:0', 'inner:1']])
      expect(results).toEqual([
        { id: 'inner:0', cid: await computeCid(first), ok: false, error: expect.objectContaining({ message: expect.stringContaining('out of space') }) },
        { id: 'inner:1', cid: await computeCid(second), ok: true },
      ])
    })

    it('publishes when a pin is never confirmed, and reports it', async () => {
      const { store: inner } = recordingStore()
      const results: PinResult[] = []
      const store = ipfsMirror(inner, {
        pinning: kuboRpcPinning({ url: ipfs.url }),
        required: false,
        onPinResult: (r) => results.push(r),
        ...fast,
      })
      const bytes = new Uint8Array([22])
      const prepared = await store.prepare([await upload('image', bytes)], {})
      await store.assertStored(prepared.ids)
      expect(results).toEqual([
        { id: 'inner:0', cid: await computeCid(bytes), ok: false, error: expect.objectContaining({ message: expect.stringContaining('IPFS blobs not stored') }) },
      ])
    })

    it('publishes when the pinning endpoint is down', async () => {
      const { store: inner } = recordingStore()
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: 'http://127.0.0.1:9' }), required: false, ...fast })
      const prepared = await store.prepare([await upload('image', new Uint8Array([23]))], {})
      await store.send(prepared.pending!, {})
      await store.assertStored(prepared.ids)
    })

    it('still fails the publish when the wrapped store fails', async () => {
      const { store: inner } = recordingStore()
      inner.send = async () => {
        throw new Error('arweave down')
      }
      inner.assertStored = async () => {
        throw new Error('arweave not stored')
      }
      const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), required: false, ...fast })
      const prepared = await store.prepare([await upload('image', new Uint8Array([24]))], {})
      await expect(store.send(prepared.pending!, {})).rejects.toThrow('arweave down')
      await expect(store.assertStored(prepared.ids)).rejects.toThrow('arweave not stored')
    })

    it('a throwing onPinResult does not fail the publish', async () => {
      const { store: inner } = recordingStore()
      const store = ipfsMirror(inner, {
        pinning: kuboRpcPinning({ url: ipfs.url }),
        required: false,
        onPinResult: () => {
          throw new Error('app bug')
        },
        ...fast,
      })
      const prepared = await store.prepare([await upload('image', new Uint8Array([25]))], {})
      await store.send(prepared.pending!, {})
      await store.assertStored(prepared.ids)
    })
  })
})

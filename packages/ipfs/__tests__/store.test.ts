import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BlobStore } from '@seedprotocol/publish'
import { computeCid, IPFS_CID_TAG, ipfsBlobStore, ipfsMirror, kuboRpcPinning, pinataPinning } from '../src'
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

  it('fails the publish when the IPFS copy is not pinned', async () => {
    const { store: inner } = recordingStore()
    const store = ipfsMirror(inner, { pinning: kuboRpcPinning({ url: ipfs.url }), ...fast })
    const prepared = await store.prepare([await upload('image', new Uint8Array([10]))], {})
    await expect(store.assertStored(prepared.ids)).rejects.toThrow('IPFS blobs not stored')
  })
})

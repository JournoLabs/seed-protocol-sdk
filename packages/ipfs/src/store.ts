import type { BlobStore, BlobStoreContext, PreparedBlobs } from '@seedprotocol/publish'
import { sha256, toCar, toHex, unixFsDag, type UnixFsDag } from './cid'
import { DEFAULT_GATEWAYS, ipfsGatewayUrls, parseIpfsId } from './gateway'
import type { Fetch, PinningProvider } from './pinning/types'

type Upload = Parameters<BlobStore['prepare']>[0][number]

export type IpfsStoreOptions = {
  /** Where uploads go. With several, each gets every upload and each must succeed. */
  pinning: PinningProvider | PinningProvider[]
  /**
   * Gateways `assertStored` asks when a provider has no `isPinned`. Defaults to
   * {@link DEFAULT_GATEWAYS}; put your provider's own gateway first, since a public gateway may
   * take a while to find newly pinned content.
   */
  gateways?: string[]
  /** How long `assertStored` waits for every blob to be readable. Default 120 s. */
  storedTimeoutMs?: number
  /** Time between `assertStored` checks. Default 2 s. */
  pollIntervalMs?: number
  /** Used for gateway checks. Defaults to the global `fetch`. */
  fetch?: Fetch
}

/** The tag an {@link ipfsMirror} adds to each upload it hands the wrapped store. */
export const IPFS_CID_TAG = 'IPFS-CID'

/** A blob's DAG, waiting to be sent. */
type PendingDag = { kind: 'ipfs'; dag: UnixFsDag }

/** Bytes of an upload, checked against its Content-SHA-256 as the SDK's readPublishUploadBytes does. */
async function uploadBytes(upload: Upload): Promise<Uint8Array> {
  const bytes = new Uint8Array(await upload.blob.arrayBuffer())
  if (upload.contentHash && toHex(await sha256(bytes)) !== upload.contentHash) {
    throw new Error(
      `The content of ${upload.itemPropertyName} changed after the publish read it. Publish again.`,
    )
  }
  return bytes
}

/** The parts of an IPFS store that {@link ipfsBlobStore} and {@link ipfsMirror} share. */
function ipfsWriter(options: IpfsStoreOptions) {
  const providers = Array.isArray(options.pinning) ? options.pinning : [options.pinning]
  if (providers.length === 0) throw new Error('@seedprotocol/ipfs: pass at least one pinning provider')
  const gateways = options.gateways ?? DEFAULT_GATEWAYS
  const timeoutMs = options.storedTimeoutMs ?? 120_000
  const intervalMs = options.pollIntervalMs ?? 2_000
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))

  const dags = async (uploads: Upload[]): Promise<UnixFsDag[]> => {
    const out: UnixFsDag[] = []
    for (const upload of uploads) out.push(await unixFsDag(await uploadBytes(upload)))
    return out
  }

  const send = async (pending: PendingDag[]) => {
    for (const { dag } of pending) {
      const car = toCar(dag)
      await Promise.all(providers.map((p) => p.pinCar(car, dag.root)))
    }
  }

  const gatewayHas = async (cid: string) => {
    for (const url of ipfsGatewayUrls(`ipfs://${cid}`, gateways)) {
      try {
        const response = await doFetch(url, { method: 'HEAD' })
        if (response.ok) return true
      } catch {
        // Try the next gateway.
      }
    }
    return false
  }

  /** Whether every provider that can say has `cid` pinned; else whether a gateway serves it. */
  const isStored = async (cid: string) => {
    const checkers = providers.filter((p) => p.isPinned)
    if (checkers.length === 0) return gatewayHas(cid)
    const pinned = await Promise.all(checkers.map((p) => p.isPinned!(cid)))
    if (!pinned.every(Boolean)) return false
    // A provider without isPinned (Pinata) is still importing until a gateway serves the CID.
    return checkers.length === providers.length || gatewayHas(cid)
  }

  const assertCidsStored = async (cids: string[]) => {
    const deadline = Date.now() + timeoutMs
    let missing = [...new Set(cids)]
    for (;;) {
      const stored = await Promise.all(missing.map(isStored))
      missing = missing.filter((_, i) => !stored[i])
      if (missing.length === 0) return
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`IPFS blobs not stored after ${timeoutMs / 1000}s: ${missing.join(', ')}`)
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  return { dags, send, assertCidsStored }
}

const isPendingDag = (item: unknown): item is PendingDag => (item as PendingDag | undefined)?.kind === 'ipfs'

/**
 * Publishes blobs to IPFS. Each upload's id is `ipfs://<cidv1>`, computed in `prepare` from its
 * bytes; `send` uploads each blob as a CAR to every provider; `assertStored` waits until every
 * provider reports the pin, or a gateway serves the CID when a provider can't report it.
 *
 * Readers that know only Arweave ids can't load these blobs yet, and Html that embeds images links
 * them through the Arweave gateway. {@link ipfsMirror} keeps Arweave ids and adds IPFS copies.
 */
export function ipfsBlobStore(options: IpfsStoreOptions): BlobStore {
  const writer = ipfsWriter(options)
  return {
    id: 'ipfs',
    async prepare(uploads): Promise<PreparedBlobs> {
      const dags = await writer.dags(uploads)
      return { ids: dags.map((d) => `ipfs://${d.root}`), pending: dags.map((dag): PendingDag => ({ kind: 'ipfs', dag })) }
    },
    async send(pending) {
      if (!pending.every(isPendingDag)) throw new Error('@seedprotocol/ipfs: send got uploads it did not prepare')
      await writer.send(pending)
    },
    async assertStored(ids) {
      const cids = ids.map((id) => {
        const parsed = parseIpfsId(id)
        if (!parsed) throw new Error(`Not an IPFS storage id: ${id}`)
        return parsed.cid
      })
      await writer.assertCidsStored(cids)
    },
  }
}

type MirrorPending = { kind: 'mirror'; inner?: unknown[]; ipfs: PendingDag[] }

/**
 * `store` with a copy of every blob on IPFS. Publish attests `store`'s ids; each upload reaches
 * `store` with an `IPFS-CID` tag naming its CID, so an Arweave copy can be found by CID with a
 * GraphQL tag query. `send` uploads to both, and `assertStored` checks both, so a failed pin fails
 * the publish.
 *
 * ```ts
 * blobStore: ipfsMirror(arweaveBlobStore, { pinning: kuboRpcPinning({ url }) })
 * ```
 */
export function ipfsMirror(store: BlobStore, options: IpfsStoreOptions): BlobStore {
  const writer = ipfsWriter(options)
  // The CIDs behind ids prepared in this session. A publish restored after a reload has no pending
  // uploads and must publish again, so a missing entry only skips the IPFS check for that id.
  const cidById = new Map<string, string>()

  return {
    id: `${store.id}+ipfs`,
    async prepare(uploads, ctx: BlobStoreContext): Promise<PreparedBlobs> {
      const dags = await writer.dags(uploads)
      const tagged = uploads.map((upload, i) => ({
        ...upload,
        tags: [...upload.tags.filter((t) => t.name !== IPFS_CID_TAG), { name: IPFS_CID_TAG, value: dags[i]!.root }],
      }))
      const inner = await store.prepare(tagged, ctx)
      inner.ids.forEach((id, i) => cidById.set(id, dags[i]!.root))
      const pending: MirrorPending = {
        kind: 'mirror',
        inner: inner.pending,
        ipfs: dags.map((dag) => ({ kind: 'ipfs', dag })),
      }
      return { ids: inner.ids, pending: [pending] }
    },
    async send(pending, ctx) {
      const batches = pending as MirrorPending[]
      if (!batches.every((b) => b?.kind === 'mirror')) {
        throw new Error('@seedprotocol/ipfs: send got uploads it did not prepare')
      }
      await Promise.all(
        batches.flatMap((b) => [b.inner?.length ? store.send(b.inner, ctx) : undefined, writer.send(b.ipfs)]),
      )
    },
    async assertStored(ids) {
      const cids = ids.flatMap((id) => cidById.get(id) ?? [])
      await Promise.all([store.assertStored(ids), writer.assertCidsStored(cids)])
      for (const id of ids) cidById.delete(id)
    },
  }
}

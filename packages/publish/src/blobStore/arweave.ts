import debug from 'debug'
import { readPublishUploadBytes, type PublishUploadData } from '@seedprotocol/sdk'
import { getPublishConfig } from '~/config'
import { resolvePublishPayment } from '~/payment'
import { publishAuthorizationHeaders } from '~/authorization'
import {
  buildPublishAnchorBytes,
  createSignedDataItem,
  createSignedDataItemWithAccount,
  isEthersWallet,
  verifyDataItem,
} from '~/helpers/arweave'
import { isPublishWallet, type SeedSigner } from '~/helpers/seedSigner'
import { uploadToTurbo } from '~/services/publish/helpers/uploadToTurbo'
import { verifyArweaveTransactionsExist } from '~/services/publish/helpers/verifyArweaveTransactionsExist'
import type { BlobStore, BlobStoreContext, PreparedBlobs } from './types'

const logger = debug('seedProtocol:blobStore:arweave')

const BATCH_UPLOAD_TIMEOUT_MS = 120_000

type DataItemLike = {
  raw?: Uint8Array
  filename?: string
  getRaw?: () => Uint8Array | Promise<Uint8Array>
}

const importDynamic = new Function('s', 'return import(s)') as (specifier: string) => Promise<{
  readFile: (path: string) => Promise<Uint8Array>
}>

let nodeFsPromisesCache: { readFile: (path: string) => Promise<Uint8Array> } | null = null

const getNodeFsPromises = async () => {
  if (nodeFsPromisesCache) return nodeFsPromisesCache
  if (typeof window !== 'undefined') return null
  try {
    const mod = await importDynamic(`node:${['fs', 'promises'].join('/')}`)
    nodeFsPromisesCache = { readFile: mod.readFile }
    return nodeFsPromisesCache
  } catch {
    return null
  }
}

/** Raw bytes of one DataItem. Plain Uint8Array (Node Buffers are one), so no Buffer global. */
async function rawBytes(item: unknown): Promise<Uint8Array> {
  const o = item as DataItemLike
  if (o.raw instanceof Uint8Array) return o.raw
  if (typeof o.getRaw === 'function') {
    const resolved = await o.getRaw()
    return resolved instanceof Uint8Array ? resolved : new Uint8Array(resolved)
  }
  if (o.filename != null) {
    const nodeFsPromises = await getNodeFsPromises()
    if (!nodeFsPromises) {
      throw new Error(
        'DataItem.filename requires Node.js fs access. In browser runtime, provide DataItem.raw or DataItem.getRaw().'
      )
    }
    return nodeFsPromises.readFile(o.filename)
  }
  throw new Error('Cannot get raw bytes from DataItem')
}

/**
 * Signs each upload as an ANS-104 DataItem. With an app's `signDataItems`, the app signs and
 * uploads them itself and only the ids come back.
 */
async function prepare(uploads: PublishUploadData[], ctx: BlobStoreContext): Promise<PreparedBlobs> {
  const { signDataItems, dataItemSigner } = ctx
  if (signDataItems) {
    const result = await signDataItems(uploads)
    return { ids: result.map((r) => r.transaction.id) }
  }
  if (!dataItemSigner) {
    throw new Error(
      '@seedprotocol/publish: uploading data items needs signDataItems or a dataItemSigner (pass one at createPublish or in the PublishProvider config). ' +
        "It must be an EOA's key: a smart account's signatures don't verify as Arweave data items, so pass its admin EOA's signer."
    )
  }

  const items: Awaited<ReturnType<typeof createSignedDataItem>>[] = []
  const timestampMs = Date.now()
  for (let i = 0; i < uploads.length; i++) {
    const upload = uploads[i]!
    const data = await readPublishUploadBytes(upload)
    const randomUniq = new Uint8Array(8)
    crypto.getRandomValues(randomUniq)
    const uniqueness = (new DataView(randomUniq.buffer).getBigUint64(0, false) ^ BigInt(i)) & 0xffffffffffffffffn

    let dataItem: Awaited<ReturnType<typeof createSignedDataItem>>
    if (isEthersWallet(dataItemSigner)) {
      const rawAnchor = buildPublishAnchorBytes(dataItemSigner.address, timestampMs, uniqueness)
      dataItem = await createSignedDataItem(data, dataItemSigner, upload.tags, rawAnchor)
    } else {
      const seedSigner: SeedSigner = isPublishWallet(dataItemSigner) ? dataItemSigner.signer : dataItemSigner
      const rawAnchor = buildPublishAnchorBytes(seedSigner.address, timestampMs, uniqueness)
      dataItem = await createSignedDataItemWithAccount(data, seedSigner, upload.tags, rawAnchor)
    }

    if (!(await verifyDataItem(dataItem.raw))) {
      logger('DataItem verification failed: id=%s modelName=%s', dataItem.id, upload.itemPropertyName)
      throw new Error(
        `DataItem signature verification failed for ${upload.itemPropertyName}. ` +
          'The signing key may not match the owner, or the payload may have been modified.'
      )
    }
    items.push(dataItem)
  }
  return { ids: items.map((item) => item.id), pending: items }
}

/** Sends signed data items where `payment.storage` says: Turbo, or the upload API's batch route. */
async function send(items: unknown[], ctx: BlobStoreContext): Promise<void> {
  const config = getPublishConfig()
  const { uploadApiBaseUrl } = config
  const { storage } = resolvePublishPayment(config)

  if (storage.uploadTo === 'turbo' && storage.turbo) {
    await uploadToTurbo(items, storage.turbo, ctx)
    return
  }

  if (!uploadApiBaseUrl) {
    throw new Error('Arweave bundler not configured. Set uploadApiBaseUrl.')
  }

  const bundlerUrl = `${uploadApiBaseUrl.replace(/\/$/, '')}/api/upload/arweave/batch`

  // Batch body: item count, then each item's length and bytes (uint32 big-endian).
  const raws: Uint8Array[] = []
  for (const item of items) raws.push(await rawBytes(item))
  const totalSize = raws.reduce((sum, raw) => sum + 4 + raw.byteLength, 4)
  const payload = new Uint8Array(totalSize)
  const view = new DataView(payload.buffer)
  view.setUint32(0, raws.length)
  let offset = 4
  for (const raw of raws) {
    view.setUint32(offset, raw.byteLength)
    offset += 4
    payload.set(raw, offset)
    offset += raw.byteLength
  }

  const controller = new AbortController()
  const uploadTimeoutId = setTimeout(() => controller.abort(), BATCH_UPLOAD_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(bundlerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...publishAuthorizationHeaders(ctx.publishAuthorization),
      },
      body: payload,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(uploadTimeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        `Arweave batch upload timed out after ${BATCH_UPLOAD_TIMEOUT_MS / 1000}s (upload API did not respond). Check uploadApiBaseUrl and network.`,
      )
    }
    throw err
  }
  clearTimeout(uploadTimeoutId)

  if (!response.ok) {
    throw new Error(`Batch upload failed: ${response.status}`)
  }

  const body = (await response.json().catch(() => ({}))) as { failed?: number; total?: number; succeeded?: number }
  const failed = typeof body.failed === 'number' ? body.failed : 0
  if (failed > 0) {
    const total = body.total ?? '?'
    const succeeded = body.succeeded ?? 0
    throw new Error(`Arweave batch upload failed: ${failed} of ${total} item(s) failed (${succeeded} succeeded)`)
  }
}

/** Arweave through the upload API's bundler, or Turbo for user-paid storage. The default blob store. */
export const arweaveBlobStore: BlobStore = {
  id: 'arweave',
  prepare,
  send,
  assertStored: (ids) => verifyArweaveTransactionsExist(ids),
}

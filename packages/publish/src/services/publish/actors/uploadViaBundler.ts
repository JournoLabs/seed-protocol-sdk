import { EventObject, fromCallback } from 'xstate'
import type { PublishMachineContext } from '../../../types'
import { getPublishConfig } from '~/config'
import { resolvePublishPayment } from '~/payment'
import { uploadToTurbo } from '../helpers/uploadToTurbo'
import { publishAuthorizationHeaders } from '~/authorization'

const BATCH_UPLOAD_TIMEOUT_MS = 120_000
const importDynamic = new Function('s', 'return import(s)') as (specifier: string) => Promise<{
  readFile: (path: string) => Promise<Uint8Array>
}>

type DataItemLike = {
  raw?: Uint8Array
  filename?: string
  getRaw?: () => Uint8Array | Promise<Uint8Array>
}

let nodeFsPromisesCache: { readFile: (path: string) => Promise<Uint8Array> } | null = null

const getNodeFsPromises = async () => {
  if (nodeFsPromisesCache) return nodeFsPromisesCache
  if (typeof window !== 'undefined') return null

  try {
    const specifier = `node:${['fs', 'promises'].join('/')}`
    const mod = await importDynamic(specifier)
    nodeFsPromisesCache = {
      readFile: mod.readFile,
    }
    return nodeFsPromisesCache
  } catch {
    return null
  }
}

/**
 * Bundler batch upload reads from context.signedDataItems (dataItemSigner path only).
 * arweaveTransactions / publishUploads hold ids and metadata for later attestations.
 * When signDataItems is used, the callback handles upload (e.g. ArConnect) so signedDataItems
 * is undefined — we skip the upload step and send uploadComplete immediately.
 */
/** The data items to upload are gone, e.g. the publish was restored after a reload. */
export class MissingSignedDataItemsError extends Error {
  readonly code = 'SIGNED_DATA_ITEMS_MISSING'
  constructor() {
    super(
      'The signed data items to upload are missing (they are not saved with the publish, so a publish resumed after a reload has none). Publish again.',
    )
    this.name = 'MissingSignedDataItemsError'
  }
}

export const uploadViaBundler = fromCallback<EventObject, { context: PublishMachineContext }>(
  ({ sendBack, input: { context } }) => {
    const { signedDataItems } = context

    const config = getPublishConfig()
    const { uploadApiBaseUrl } = config
    const { storage } = resolvePublishPayment(config)

    // No items: either there is nothing to upload (the app's signDataItems uploaded them itself,
    // or there were none), or they were lost (they aren't saved with the publish, so a publish
    // restored after a reload has none). Finishing on the second would attest data items that
    // were never uploaded.
    if (!signedDataItems || signedDataItems.length === 0) {
      if (context.bundlerUploadNotNeeded) {
        sendBack({ type: 'uploadComplete', result: 'done' })
      } else {
        sendBack({ type: 'uploadError', error: new MissingSignedDataItemsError() })
      }
      return
    }

    if (storage.uploadTo === 'turbo' && storage.turbo) {
      uploadToTurbo(signedDataItems as unknown[], storage.turbo, context)
        .then(() => sendBack({ type: 'uploadComplete', result: 'done' }))
        .catch((error) => sendBack({ type: 'uploadError', error }))
      return
    }

    if (!uploadApiBaseUrl) {
      sendBack({
        type: 'uploadError',
        error: new Error('Arweave bundler not configured. Set uploadApiBaseUrl.'),
      })
      return
    }

    const bundlerUrl = `${uploadApiBaseUrl.replace(/\/$/, '')}/api/upload/arweave/batch`

    const _uploadViaBundler = async () => {
      const items = signedDataItems as unknown[]

      /** Raw bytes of one DataItem. Plain Uint8Array (Node Buffers are one), so no Buffer global. */
      const rawBytes = async (item: unknown): Promise<Uint8Array> => {
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
            ...publishAuthorizationHeaders(context.publishAuthorization),
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
        throw new Error(
          `Arweave batch upload failed: ${failed} of ${total} item(s) failed (${succeeded} succeeded)`
        )
      }
    }

    _uploadViaBundler()
      .then(() => sendBack({ type: 'uploadComplete', result: 'done' }))
      .catch((error) => sendBack({ type: 'uploadError', error }))
  }
)

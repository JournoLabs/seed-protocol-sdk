import { EventObject, fromCallback } from 'xstate'
import { readFile, stat } from 'node:fs/promises'
import type { PublishMachineContext } from '../../../types'
import { getPublishConfig } from '~/config'

const BATCH_UPLOAD_TIMEOUT_MS = 120_000

type DataItemLike = {
  raw?: Uint8Array
  filename?: string
  getRaw?: () => Buffer | Promise<Buffer>
}

/**
 * Bundler batch upload reads from context.signedDataItems (dataItemSigner path only).
 * arweaveTransactions / publishUploads hold ids and metadata for later attestations.
 * When signDataItems is used, the callback handles upload (e.g. ArConnect) so signedDataItems
 * is undefined — we skip the upload step and send uploadComplete immediately.
 */
export const uploadViaBundler = fromCallback<EventObject, { context: PublishMachineContext }>(
  ({ sendBack, input: { context } }) => {
    const { signedDataItems } = context

    const { uploadApiBaseUrl, useArweaveBundler } = getPublishConfig()

    if (!useArweaveBundler || !uploadApiBaseUrl) {
      sendBack({
        type: 'uploadError',
        error: new Error(
          'Arweave bundler not configured. Set useArweaveBundler and uploadApiBaseUrl.'
        ),
      })
      return
    }

    const bundlerUrl = `${uploadApiBaseUrl.replace(/\/$/, '')}/api/upload/arweave/batch`

    if (!signedDataItems || signedDataItems.length === 0) {
      // signDataItems path: external signer (e.g. ArConnect) already uploaded; skip and proceed
      sendBack({ type: 'uploadComplete', result: 'done' })
      return
    }

    const _uploadViaBundler = async () => {
      const items = signedDataItems as unknown[]
      const itemCount = items.length
      const getRawCache: (Buffer | null)[] = new Array(itemCount).fill(null)

      /** Length only (pass 1). Caches buffer for getRaw() items to avoid a second read. */
      const rawByteLength = async (item: unknown, i: number): Promise<number> => {
        const o = item as DataItemLike
        if (o.raw != null && (o.raw instanceof Uint8Array || Buffer.isBuffer(o.raw))) {
          return o.raw.byteLength
        }
        if (typeof o.getRaw === 'function') {
          const r = o.getRaw()
          const resolved = r instanceof Promise ? await r : r
          const buf = Buffer.isBuffer(resolved) ? resolved : Buffer.from(resolved)
          getRawCache[i] = buf
          return buf.length
        }
        if (o.filename != null) {
          const st = await stat(o.filename)
          return st.size
        }
        throw new Error('Cannot get raw bytes from DataItem')
      }

      let totalSize = 4
      const lengths: number[] = []
      for (let i = 0; i < itemCount; i++) {
        const len = await rawByteLength(items[i], i)
        lengths.push(len)
        totalSize += 4 + len
      }

      const payload = Buffer.alloc(totalSize)
      let offset = 0
      payload.writeUInt32BE(itemCount, offset)
      offset += 4

      for (let i = 0; i < itemCount; i++) {
        const len = lengths[i]!
        const cached = getRawCache[i]
        if (cached) {
          payload.writeUInt32BE(len, offset)
          offset += 4
          cached.copy(payload, offset)
          offset += len
          continue
        }

        const o = items[i] as DataItemLike
        if (o.raw != null && (o.raw instanceof Uint8Array || Buffer.isBuffer(o.raw))) {
          payload.writeUInt32BE(len, offset)
          offset += 4
          payload.set(o.raw, offset)
          offset += len
          continue
        }
        if (o.filename != null) {
          const buf = await readFile(o.filename)
          payload.writeUInt32BE(buf.length, offset)
          offset += 4
          buf.copy(payload, offset)
          offset += buf.length
          continue
        }
        throw new Error('Cannot get raw bytes from DataItem')
      }

      const controller = new AbortController()
      const uploadTimeoutId = setTimeout(() => controller.abort(), BATCH_UPLOAD_TIMEOUT_MS)

      let response: Response
      try {
        response = await fetch(bundlerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
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

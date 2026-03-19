import { EventObject, fromCallback } from 'xstate'
import { readFile } from 'node:fs/promises'
import type { PublishMachineContext } from '../../../types'
import { getPublishConfig } from '~/config'

/**
 * Context has: arweaveUploadData (raw file data), arweaveTransactions (DataItem IDs),
 * and signedDataItems (dataItemSigner path only - signed FileDataItem instances for upload).
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
      // FileDataItem stores signed data in a temp file; read full bytes for ANS-104 payload
      const getRawBytes = async (item: unknown): Promise<Buffer> => {
        const o = item as {
          raw?: Uint8Array
          filename?: string
          getRaw?: () => Buffer | Promise<Buffer>
        }
        if (o.raw != null && (o.raw instanceof Uint8Array || Buffer.isBuffer(o.raw))) {
          return Buffer.from(o.raw)
        }
        if (typeof o.getRaw === 'function') {
          const r = o.getRaw()
          return r instanceof Promise ? r : Buffer.from(r)
        }
        if (o.filename != null) {
          return readFile(o.filename)
        }
        throw new Error('Cannot get raw bytes from DataItem')
      }

      const rawBuffers = await Promise.all(
        (signedDataItems as unknown[]).map((item) => getRawBytes(item))
      )

      // Pack all raw data items into a single payload.
      // [4 bytes: item count][4 bytes: item 1 length][item 1 bytes][4 bytes: item 2 length][item 2 bytes]...
      const itemCount = rawBuffers.length
      let totalSize = 4
      for (const buf of rawBuffers) {
        totalSize += 4 + buf.length
      }

      const payload = Buffer.alloc(totalSize)
      let offset = 0

      payload.writeUInt32BE(itemCount, offset)
      offset += 4

      for (const buf of rawBuffers) {
        payload.writeUInt32BE(buf.length, offset)
        offset += 4
        buf.copy(payload, offset)
        offset += buf.length
      }

      const response = await fetch(bundlerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload,
      })

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

import type { PublishMachineContext } from '../../../types'
import type { ResolvedPublishPayment } from '~/payment'
import { assertTurboCanPay, ethereumSignerOfDataItem, uploadDataItemToTurbo } from '~/helpers/turbo'

// Kept out of the uploadViaBundler actor module so it can be imported (and tested) without
// pulling in ~/config, which imports the publish machine.

type DataItemLike = {
  raw?: Uint8Array
  filename?: string
  getRaw?: () => Uint8Array | Promise<Uint8Array>
}

const importDynamic = new Function('s', 'return import(s)') as (specifier: string) => Promise<{
  readFile: (path: string) => Promise<Uint8Array>
}>

async function readNodeFile(filename: string): Promise<Uint8Array> {
  if (typeof window !== 'undefined') {
    throw new Error('DataItem.filename requires Node.js fs access. In browser runtime, provide DataItem.raw or DataItem.getRaw().')
  }
  const { readFile } = await importDynamic(`node:${['fs', 'promises'].join('/')}`)
  return readFile(filename)
}

/** Raw bytes of one signed DataItem (raw, getRaw() or a Node file). */
async function rawBytesOf(item: unknown): Promise<Uint8Array> {
  const o = item as DataItemLike
  if (o.raw instanceof Uint8Array) return o.raw
  if (typeof o.getRaw === 'function') {
    const resolved = await o.getRaw()
    return resolved instanceof Uint8Array ? resolved : new Uint8Array(resolved)
  }
  if (o.filename != null) return readNodeFile(o.filename)
  throw new Error('Cannot get raw bytes from DataItem')
}

/**
 * User-paid storage (`payment.storage: 'user'`): checks the signer's Turbo credits cover the
 * items, then POSTs each to Turbo, which charges the signer (or `paidBy`).
 */
export async function uploadToTurbo(
  items: unknown[],
  turbo: NonNullable<ResolvedPublishPayment['storage']['turbo']>,
  context: PublishMachineContext,
): Promise<void> {
  const raws = await Promise.all(items.map(rawBytesOf))
  const signerAddress =
    (context.dataItemSigner as { address?: string } | undefined)?.address ??
    (raws[0] ? ethereumSignerOfDataItem(raws[0]) : undefined)
  if (!signerAddress) {
    throw new Error('User-paid storage needs Ethereum-signed data items (dataItemSigner).')
  }
  if (turbo.paidBy.length === 0) {
    await assertTurboCanPay(turbo, signerAddress, raws.map((r) => r.byteLength))
  }
  for (const raw of raws) {
    await uploadDataItemToTurbo(turbo, raw, { signerAddress, paidBy: turbo.paidBy })
  }
}

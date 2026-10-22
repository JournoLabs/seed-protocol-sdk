import { Item, type IItem } from '@seedprotocol/sdk'

export const ZERO_BYTES32 = '0x' + '0'.repeat(64)
export const BYTES32_LEN = 64

/**
 * The Item for a seedLocalId, looked up every 200 ms until it loads. Takes one cache hold, which
 * the caller releases with `unload()`. One lookup runs at a time, so no other lookup's hold is left
 * behind.
 */
export const waitForItem = async (seedLocalId: string): Promise<IItem<any>> => {
  for (;;) {
    const item = await Item.find({ seedLocalId }).catch(() => undefined)
    if (item) return item
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

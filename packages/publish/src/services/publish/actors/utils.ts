import { Item, type IItem } from '@seedprotocol/sdk'

export const ZERO_BYTES32 = '0x' + '0'.repeat(64)
export const BYTES32_LEN = 64

export const waitForItem = async (seedLocalId: string): Promise<IItem<any>> => {
  let item: IItem<any> | undefined

  try {
    item = await Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
  } catch {
    // No-op: Error is intentionally ignored
  }

  if (item) {
    return item
  }

  return new Promise<IItem<any>>((resolve) => {
    const interval = setInterval(() => {
      try {
        Item.find({ seedLocalId } as Parameters<typeof Item.find>[0])
          .then((found: IItem<any> | undefined) => {
            if (found) {
              clearInterval(interval)
              resolve(found)
            }
          })
      } catch {
        // No-op: Error is intentionally ignored
      }
    }, 200)
  })
}

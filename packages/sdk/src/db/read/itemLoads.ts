import type { GetItemParams, ItemFindProps } from '@/types'
import type { IItem } from '@/interfaces'

/**
 * The items one internal read loads (a publish payload build, a publish walk). `getItem` and
 * `Item.find` take a cache hold on each item they return; `release()` drops this read's holds, so
 * an item nobody else holds stops instead of staying loaded for the session. A read that hands
 * none of these items to its caller releases them when it is done.
 */
export class ItemLoads {
  private readonly held: IItem<any>[] = []

  async getItem(params: GetItemParams): Promise<IItem<any> | undefined> {
    // Dynamic imports: getItem and Item import the publish readers that use this
    const { getItem } = await import('./getItem')
    return this.keep(await getItem(params))
  }

  async find(params: ItemFindProps): Promise<IItem<any> | undefined> {
    const { Item } = await import('@/Item/Item')
    return this.keep(await Item.find(params))
  }

  /** Adds an item the caller loaded (one hold) to the holds `release()` drops. */
  keep<I extends IItem<any> | undefined>(item: I): I {
    if (item) this.held.push(item)
    return item
  }

  /** Drops every hold this read took, except one hold on each item in `except`, which passes to the caller. */
  release(except: Iterable<IItem<any>> = []): void {
    const kept = new Set(except)
    for (const item of this.held.splice(0)) {
      if (kept.delete(item)) continue
      try {
        item.unload()
      } catch {
        // Already stopped
      }
    }
  }
}

/** Runs `read` with `loads`, or with its own ItemLoads released when `read` settles. */
export async function withItemLoads<T>(
  loads: ItemLoads | undefined,
  read: (loads: ItemLoads) => Promise<T>,
): Promise<T> {
  if (loads) return read(loads)
  const own = new ItemLoads()
  try {
    return await read(own)
  } finally {
    own.release()
  }
}

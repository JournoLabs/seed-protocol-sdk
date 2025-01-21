import { isBrowser } from '@/helpers/environment'
import { BaseItem } from '@/Item/BaseItem'

let Item: typeof BaseItem | undefined


export const initItem = async () => {
  if (isBrowser()) {
    Item = (await import('../browser/Item/Item')).Item
  }

  if (!isBrowser()) {
    Item = (await import('../node/Item/Item')).Item
  }
}

export { Item }

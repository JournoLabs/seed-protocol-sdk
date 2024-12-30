import { IItem } from '@/interfaces'

let Item: IItem<any> | undefined


export const initItem = async () => {

  if (typeof window !== 'undefined') {
    Item = (await import('../browser/Item/Item')).Item
  } else {
    Item = (await import('../node/Item/Item')).Item
  }
}

export { Item }

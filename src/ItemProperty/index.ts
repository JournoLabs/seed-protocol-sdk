import { IItemProperty } from '@/interfaces'

let ItemProperty: IItemProperty<any> | undefined


export const initItemProperty = async () => {

  if (typeof window !== 'undefined') {
    ItemProperty = (await import('../browser/ItemProperty/ItemProperty')).ItemProperty
  } else {
    ItemProperty = (await import('../node/ItemProperty/ItemProperty')).ItemProperty
  }
}

export { ItemProperty }

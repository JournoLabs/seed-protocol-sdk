import { isBrowser } from '@/helpers/environment'
import { BaseItemProperty } from '@/ItemProperty/BaseItemProperty'

let ItemProperty: typeof BaseItemProperty | undefined

export const initItemProperty = async () => {

  if (isBrowser()) {
    ItemProperty = (await import('../browser/ItemProperty/ItemProperty')).ItemProperty
  }

  if (!isBrowser()) {
    ItemProperty = (await import('../node/ItemProperty/ItemProperty')).ItemProperty
  }
}

export { ItemProperty }
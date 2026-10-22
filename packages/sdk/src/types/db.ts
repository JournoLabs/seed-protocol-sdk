import { ItemData } from "./item"
import { PropertyData } from "./property"


export type GetItemDataParams = {
  modelName?: string
  seedLocalId?: string
  seedUid?: string
}

export type GetItemData = (
  params: GetItemDataParams,
) => Promise<ItemData | undefined>

export type GetPropertiesForSeedProps = {
  seedLocalId?: string
  seedUid?: string
  edited?: boolean
}

export type GetItemProperties = (
  props: GetPropertiesForSeedProps,
) => Promise<PropertyData[]>

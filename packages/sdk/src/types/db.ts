import { IItem } from "@/interfaces"
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

export type GetPropertyDataOptions = {
  propertyName: string
  seedLocalId?: string
  seedUid?: string
  /** When set, List-of-relation metadata rows (e.g. authorIdentityIds) are included when querying by schema key (authors). */
  modelName?: string
}

export type GetPropertiesForSeedProps = {
  seedLocalId?: string
  seedUid?: string
  edited?: boolean
}

export type GetItemProperties = (
  props: GetPropertiesForSeedProps,
) => Promise<PropertyData[]>

export type GetItemParams = {
  modelName?: string
  seedLocalId?: string
  seedUid?: string
}

export type GetItem = (params: GetItemParams) => Promise<IItem<any> | undefined>

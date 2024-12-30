import { Static } from '@sinclair/typebox'
import {
  TProperty,
  TPropertyDataType,
  TPropertyDefs,
  TStorageType,
} from '@/browser/schema'
import { MetadataType } from '@/seedSchema'

export type PropertyDataType = Static<typeof TPropertyDataType>

export type StorageType = Static<typeof TStorageType>

export type PropertyType = Static<typeof TProperty>

export type PropertyConstructor = (ref?: string) => PropertyType

export type PropertyDefs = Static<typeof TPropertyDefs>

export type PropertyValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | Record<string, unknown>[]

export type PropertyState = Record<string, unknown>

export type PropertyStates = {
  Created: PropertyState
  Idle: PropertyState
  Fetching: PropertyState
  FetchSuccess: PropertyState
  FetchError: PropertyState
}

export type PropertyData = {
  localId: string
  uid: string
  schemaUid: string
  propertyName: string
  propertyValue: string
  versionUid?: string
  attestationCreatedAt?: number
  refSeedType: string
  refValueType: string
  seedLocalId: string
  seedUid: string
  createdAt: number
  updatedAt: number
}
export type PropertyMachineContext = Partial<MetadataType> & {
  populatedFromDb?: boolean
  isSaving: boolean
  propertyRecordSchema?: PropertyType
  isRelation: boolean
  modelName: string
  isDbReady: boolean
  renderValue?: any
  storageTransactionId?: string
  newValue?: ItemPropertyValueType
}

export type ItemPropertyValueType =
  | string
  | number
  | Record<string, unknown>
  | null
  | undefined
  | any[]

export type SaveValueToDbEvent = {
  type: 'saveValueToDb'
  newValue: ItemPropertyValueType
}

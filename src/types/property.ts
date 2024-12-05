import { Static } from '@sinclair/typebox'
import {
  TProperty,
  TPropertyDataType,
  TPropertyDefs,
  TStorageType,
} from '@/browser/schema'

export type ItemPropertyProps = {
  localId: string
  uid?: string
  propertyName?: string
  propertyValue?: any
  seedUid?: string
  seedLocalId?: string
  versionLocalId?: string
  versionUid?: string
  itemModelName: string
  schemaUid?: string
  storageTransactionId?: string
}

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
export type PropertyMachineContext = {
  localId: string
  uid: string
  fetchedValue: any
  isSaving: boolean
  pendingFetch: boolean
  savedData: any
  propertyName: string
  propertyValue: any
  propertyValueType: string
  propertyRelationValueType?: string
  resolvedValue?: any
  resolvedDisplayValue?: any
  propertyRecordSchema?: PropertyType
  isRelation: boolean
  itemModelName: string
  schemaUid?: string
  isDbReady: boolean
  seedLocalId?: string
  seedUid?: string
  versionLocalId?: string
  versionUid?: string
  renderValue?: any
  storageTransactionId?: string
  refValueType?: string
  localStorageDir?: string
  newValue?: ItemPropertyValueType
}

export type UpdateContextEvent = PropertyMachineContext & {
  type: 'updateContext'
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

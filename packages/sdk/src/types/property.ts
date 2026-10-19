import { Static } from '@sinclair/typebox'
import {
  TProperty,
  TPropertyDataType,
  TPropertyDefs,
  TStorageType,
} from '@/Schema'
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

export type ItemPropertyValueType =
  | string
  | number
  | Record<string, unknown>
  | null
  | undefined
  | any[]

/** DB metadata uses string `property_value`; machine context also holds parsed List values as arrays. */
export type PropertyMachineContext = Omit<Partial<MetadataType>, 'propertyValue'> & {
  propertyValue?: ItemPropertyValueType
  populatedFromDb?: boolean
  isSaving: boolean
  propertyRecordSchema?: PropertyType
  isRelation: boolean
  modelName: string
  /** schemaFileId of the owning item's models row; scopes property-definition lookups to that model. */
  modelFileId?: string
  isDbReady: boolean
  renderValue?: any
  storageTransactionId?: string
  newValue?: ItemPropertyValueType
  /** Destroy failure from the last destroy() (read by destroy hooks). */
  _destroyError?: { message: string; name?: string } | null
  /** Validation errors from last failed save (enum, pattern, etc.). Cleared on successful save. */
  _saveValidationErrors?: import('@/Schema/validation').ValidationError[]
  /**
   * Error from the last failed save (ownership refusal, file save, metadata creation), as thrown, so
   * its class and fields (`code`, `cause`) survive. Cleared when the next save starts.
   */
  _saveError?: Error | null
  /**
   * The unresolved conflict between this property's last local edit and a value sync wrote while
   * it was pending (ADR 0019); null when there is none.
   */
  conflict?: import('@/outbox/conflicts').PropertyConflict | null
  /** Set by an assignment's save: the values to restore if that save fails. */
  _valueBeforeSave?: PropertyValueSnapshot
}

export type SaveValueToDbEvent = {
  type: 'saveValueToDb'
  newValue: ItemPropertyValueType
  /** Values shown before an assignment; restored if the save is refused or fails. */
  before?: PropertyValueSnapshot
}

export type PropertyValueSnapshot = { propertyValue?: unknown; renderValue?: unknown }

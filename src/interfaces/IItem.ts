import { ActorRefFrom, Subscription } from 'xstate'
import { ItemProperty } from '@/browser/property/ItemProperty'
import { CreatePropertyInstanceProps, ModelSchema, ModelValues, PropertyData } from '@/types'
import { VersionsType } from '@/seedSchema/VersionSchema'

export interface IItem<T extends ModelValues<ModelSchema>> {
  subscribe(callback: (itemProps: any) => void): Subscription
  getService(): ActorRefFrom<any>
  getEditedProperties(): Promise<PropertyData[]>
  publish(): Promise<void>
  getPublishUploads(): Promise<any>
  getPublishPayload(uploadedTransactions: any[]): Promise<any>
  unload(): void

  readonly seedLocalId: string
  readonly seedUid?: string
  readonly schemaUid: string
  readonly latestVersionUid: VersionsType
  readonly modelName: string
  readonly properties: Record<string, ItemProperty<any>>
} 
import { ActorRefFrom, Subscription } from 'xstate'
import { ModelSchema, ModelValues, PropertyData } from '@/types'
import { VersionsType } from '@/seedSchema'
import { IItemProperty } from './IItemProperty'

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
  readonly latestVersionLocalId: string
  readonly modelName: string
  readonly properties: Record<string, IItemProperty<any>>
  readonly attestationCreatedAt: number
  readonly versionsCount: number
  readonly lastVersionPublishedAt: number
} 

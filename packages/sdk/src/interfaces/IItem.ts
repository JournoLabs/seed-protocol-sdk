import { ActorRefFrom, Subscription } from 'xstate'
import { ModelSchema, ModelValues, PropertyData } from '@/types'
import { VersionsType } from '@/seedSchema'
import { IItemProperty } from './IItemProperty'

export interface IItem<_T extends ModelValues<ModelSchema>> {

  subscribe(callback: (itemProps: any) => void): Subscription
  getService(): ActorRefFrom<any>
  getEditedProperties(): Promise<PropertyData[]>
  conflicts(): Promise<import('@/outbox/conflicts').PropertyConflict[]>
  /**
   * Upload and attest this item. Requires @seedprotocol/publish: `initPublish()` (or
   * `<PublishProvider config>`) registers the executor this delegates to; without it
   * this throws. Resolves when the publish has finished; rejects if it failed.
   * `options` are passed to the publish package (its CreatePublishOptions).
   */
  publish(options?: import('@/helpers/publishConfig').ItemPublishOptions): Promise<void>
  unpublish(): Promise<void>
  getPublishUploads(
    options?: import('@/db/read/getPublishUploads').GetPublishUploadsOptions,
  ): Promise<any>
  getPublishPayload(
    uploadedTransactions: any[],
    options?: { publishMode?: 'patch' | 'new_version' },
  ): Promise<any>
  persistSeedUid(publisher?: string, attestationCreatedAtMs?: number): Promise<void>
  unload(): void
  destroy(): Promise<void>

  readonly seedLocalId: string
  readonly seedUid?: string
  readonly schemaUid?: string
  readonly latestVersionUid: VersionsType
  readonly latestVersionLocalId: string
  readonly modelName: string
  readonly properties: IItemProperty<any>[]
  readonly internalProperties: Record<string, IItemProperty<any>>
  readonly allProperties: Record<string, IItemProperty<any>>
  readonly attestationCreatedAt: number
  readonly revokedAt?: number
  readonly isRevoked: boolean
  readonly versionsCount: number
  readonly lastVersionPublishedAt: number
  readonly createdAt?: number
  readonly publisher?: string
} 

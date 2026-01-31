import { tags } from 'typia';
import { ModelSchema } from '@/types'
import { Attestation } from '@/graphql/gql/graphql'
import { PropertyType } from '@/seedSchema'
import { IItem, IItemProperty } from '@/interfaces'
import { Item } from '@/Item/Item'
import type { Model } from '@/Model/Model'

export type ItemType = Partial<typeof Item>

// AllItemsMachineContext removed - allItems services have been removed

export type ItemMachineContext<T> = {
  versionLocalId?: string
  versionUid?: string
  seedLocalId?: string
  seedUid?: string
  attestationCreatedAt?: string
  ModelClass?: Model
  propertiesBySchemaUid?: Map<string, Attestation[]>
  propertiesMetadata?: Map<string, PropertyType>
  propertyInstances?: Map<string | keyof T, IItemProperty>
  relatedVersionsBySchemaUid?: Map<string, Attestation[]>
  modelTableName?: string
  modelNamePlural?: string
  modelName?: string
  existingItem?: Record<string, unknown>
  propertiesUpdatedAt?: number
  hasRemoteBackup?: boolean
  storageTransactionId?: string
  isPublishing?: boolean
  schemaUid?: string
  latestVersionUid?: string
  latestVersionLocalId?: string
  versionsCount?: number
  lastVersionPublishedAt?: number
  createdAt?: number
}

export type NewItemProps<T> = Partial<ItemData> &
  Partial<T> & {
    modelName: string
    modelInstance?: Model
    schemaUidsByModelName?: Map<string, string>
    mostRecentPropertiesBySeedUid?: Map<string, Attestation[]>
    storageTransactionId?: string
  }

export interface ItemData {
  seedLocalId?: string;
  seedUid?: string;
  modelName?: string;
  schemaUid?: string;
  attestationCreatedAt?: number & tags.Type<"int64">;
  latestVersionUid?: string;
  latestVersionLocalId?: string;
  versionsCount?: number & tags.Type<"int32">;
  lastVersionPublishedAt?: number & tags.Type<"int64">;
  lastLocalUpdateAt?: number & tags.Type<"int64">;
  type?: string;
  createdAt?: number & tags.Type<"int64">;
  updatedAt?: number & tags.Type<"int64">;
}

export type ItemFindProps = {
  modelName?: string
  seedLocalId?: string
  seedUid?: string
}

export type CreatePropertyInstanceProps = {
  propertyName: string
  seedLocalId?: string
  seedUid?: string
  versionLocalId?: string
  versionUid?: string
  modelName: string
  storageTransactionId?: string
  propertyValue: any
  schemaUid?: string
}

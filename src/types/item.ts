import { tags } from 'typia';
import { ModelClassType, ModelSchema } from '@/types'
import { Attestation } from '@/graphql/gql/graphql'
import { PropertyType } from '@/seedSchema'
import { IItem, IItemProperty } from '@/interfaces'
import { BaseItem } from '@/Item/BaseItem'

export type ItemType = Partial<typeof BaseItem>

export type AllItemsMachineContext = {
  times?: Record<string, unknown>
  addresses?: string[]
  isValidConfig: boolean
  queryVariables: Record<string, any>
  modelNameLowercase: string
  modelNamePlural: string
  modelName: string
  ModelClass?: ModelClassType
  modelSchema?: ModelSchema
  relatedProperties?: Map<string, PropertyType>
  relatedVersionsBySeedUid?: Map<string, Attestation[]>
  relatedVersionsBySchemaUid?: Map<string, Attestation[]>
  schemaUidsByModelName?: Map<string, string>
  mostRecentPropertiesBySeedUid?: Map<string, Attestation[]>
  itemSeeds?: Attestation[]
  itemVersions?: Attestation[]
  items?: IItem<any>[]
  modelAddedToDb?: boolean
}

export type ItemMachineContext<T> = {
  versionLocalId?: string
  versionUid?: string
  seedLocalId?: string
  seedUid?: string
  attestationCreatedAt?: string
  ModelClass?: ModelClassType
  propertiesBySchemaUid?: Map<string, Attestation[]>
  propertiesMetadata?: Map<string, PropertyType>
  propertyInstances?: Map<string | keyof T, IItemProperty<PropertyType>>
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
}

export type NewItemProps<T> = Partial<ItemData> &
  Partial<T> & {
    modelName: string
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

import { tags } from 'typia';
import { ModelSchema } from '@/types'
import { PropertyType as PropertySchemaType } from '@/types/property'
import type { Attestation } from '@seedprotocol/eas'
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
  schemaName?: string
  /** schemaFileId of the item's models row (seeds.model_file_id); disambiguates same-name models across schemas. */
  modelFileId?: string
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
  publisher?: string
  revokedAt?: number
  /** Last publish failure; cleared on success or reset. Serializable for XState (use message string). */
  _publishError?: { message: string } | null
  /** Destroy lifecycle (for destroy hooks). */
  _destroyInProgress?: boolean
  _destroyError?: { message: string; name?: string } | null
}

export type NewItemProps<T> = Partial<ItemData> &
  Partial<T> & {
    modelName: string
    /** Which model, when several schemas define `modelName`: the Model.id, or pass `schemaName`. */
    modelFileId?: string
    modelInstance?: Model
    schemaUidsByModelName?: Map<string, string>
    mostRecentPropertiesBySeedUid?: Map<string, Attestation[]>
    storageTransactionId?: string
  }

export interface ItemData {
  seedLocalId?: string;
  seedUid?: string;
  modelName?: string;
  schemaName?: string;
  /** schemaFileId of the item's models row (seeds.model_file_id). */
  modelFileId?: string;
  schemaUid?: string;
  attestationCreatedAt?: number & tags.Type<"int64">;
  latestVersionUid?: string;
  latestVersionLocalId?: string;
  /** Newest version row whose `uid` is a valid EAS attestation id (see getLatestPublishedVersionRow). */
  publishedVersionUid?: string;
  publishedVersionLocalId?: string;
  versionsCount?: number & tags.Type<"int32">;
  lastVersionPublishedAt?: number & tags.Type<"int64">;
  lastLocalUpdateAt?: number & tags.Type<"int64">;
  type?: string;
  createdAt?: number & tags.Type<"int64">;
  updatedAt?: number & tags.Type<"int64">;
  publisher?: string;
  revokedAt?: number & tags.Type<"int64">;
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
  /** schemaFileId of the owning item's models row. */
  modelFileId?: string
  /** metadata.property_id (properties.id) when created from a metadata row. */
  propertyId?: number
  storageTransactionId?: string
  propertyValue: any
  schemaUid?: string
  propertyRecordSchema?: PropertySchemaType
  /** For File/Image/Relation: filename or path used for display and OPFS lookup */
  refResolvedValue?: string
  /** For File/Image: blob URL or content URL for display */
  refResolvedDisplayValue?: string
  /** For File/Image: e.g. '/files' or '/images' */
  localStorageDir?: string
  /** For Html/Image/File/Relation: ref type from metadata (e.g. 'html', 'image') */
  refSeedType?: string
}

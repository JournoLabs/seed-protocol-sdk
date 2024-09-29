import { ModelClassType, ModelSchema, PropertyType } from '@/types'
import { Attestation }                               from '@/browser/gql/graphql'
import { Item }                                      from '@/browser/schema/item'


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
  items?: Item<any>[]
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
  propertyInstances?: Map<string | keyof T, ItemProperty<PropertyType>>
  relatedVersionsBySchemaUid?: Map<string, Attestation[]>
  modelTableName?: string
  modelNamePlural?: string
  modelName?: string
  existingItem?: Record<string, unknown>
}

export type NewItemProps<T> = {
  seedLocalId: string | undefined
  seedUid?: string | undefined
  schemaUid: string | undefined
  ModelClass?: ModelClassType
  schemaUidsByModelName?: Map<string, string>
  mostRecentPropertiesBySeedUid?: Map<string, Attestation[]>
} & Partial<T>

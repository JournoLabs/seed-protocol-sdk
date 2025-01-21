import { PropertyStates, PropertyValue } from './property'
import { Actor, AnyActorLogic } from 'xstate'
import { Static } from '@sinclair/typebox'
import { IModelClass, TModelSchema } from '@/schema'
import { BaseItem } from '@/Item/BaseItem'

export type ModelDefinitions = {
  [modelName: string]: ModelClassType
}

export type ModelStatus = (propName: string) => keyof PropertyStates

export type ExcludedKeys = 'states' | 'status'

type ExcludeKeys<T, K> = {
  [P in keyof T as Exclude<P, K>]: T[P]
}

export type ModelClassType = {
  originalConstructor: () => void
  schema: ModelSchema
  schemaUid?: string
  create: (values: ModelValues<any>) => Promise<BaseItem<any>>
}

export type ModelValues<T extends Record<string, any>> = BaseItem<any> & {
  schema: ModelSchema
  ModelClass?: ModelClassType
  [key: string & keyof T]: PropertyValue
}

export type StatesMap<T> = Map<string, Actor<T extends AnyActorLogic ? T : never>>

// export type ModelSchema = {
//   [key: string]: TObject
// }

export type ModelSchema = Partial<Static<typeof TModelSchema>>

export type ModelConstructor = <
  T extends { new(...args: any[]): IModelClass },
>(
  constructor: T,
) => T & IModelClass

// export type ModelConstructor = Static<TModelConstructor>

export interface ModelProperty {
  propertyLocalId?: string
  name: string
  dataType:
  | 'string'
  | 'bytes32'
  | 'uint8'
  | 'uint256'
  | 'bool'
  | 'address'
  | 'bytes'
  | 'int8'
  | 'int256'
  | 'int'
  | 'bytes32[]'
  modelSchemaUids: string[]
  modelLocalId?: string
  schemaName?: string
  schemaUid: string
  schemaDefinition: string
  relatedModelSchemaUid?: string
  relatedModelLocalId?: string
  createdAt?: number
  updatedAt?: number
}

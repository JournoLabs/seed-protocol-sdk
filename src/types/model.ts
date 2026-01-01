import { PropertyStates, PropertyValue } from './property'
import { Actor, AnyActorLogic } from 'xstate'
import { Static }                               from '@sinclair/typebox'
import { TModelSchema, TProperty } from '@/Schema'
import { BaseItem }                             from '@/Item/BaseItem'
import type { Model } from '@/Model/Model'

export type ModelDefinitions = {
  [modelName: string]: Model
}

export type ModelStatus = (propName: string) => keyof PropertyStates

export type ExcludedKeys = 'states' | 'status'

type ExcludeKeys<T, K> = {
  [P in keyof T as Exclude<P, K>]: T[P]
}

/**
 * @deprecated Use Model directly instead. This type is kept for backward compatibility during migration.
 */
export type ModelClassType = Model

export type ModelValues<T extends Record<string, any>> = BaseItem<any> & {
  schema: ModelSchema
  ModelClass?: Model
} & {
  [K in keyof T]: PropertyValue
}

export type StatesMap<T> = Map<string, Actor<T extends AnyActorLogic ? T : never>>

// export type ModelSchema = {
//   [key: string]: TObject
// }

export type ModelSchema = Partial<Static<typeof TModelSchema>>

// ModelConstructor type removed - decorator pattern no longer supported

export type ModelProperty = typeof TProperty

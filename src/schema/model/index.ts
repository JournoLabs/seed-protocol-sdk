// Export the Model class
export { Model } from './Model'
export type { ModelMachineContext } from './service/modelMachine'

// Export types (for schema validation)
import { Type } from '@sinclair/typebox'
import { TProperty } from '../property'

export const TModelValues = Type.Record(Type.String(), Type.Any())
export const TModelSchema = Type.Record(Type.String(), TProperty)

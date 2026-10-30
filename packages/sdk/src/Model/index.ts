// Export the Model class
export { Model } from './Model'

// Export types (for schema validation)
import { Type } from '@sinclair/typebox'
import { TProperty } from '../helpers/property/index'

export const TModelSchema = Type.Record(Type.String(), TProperty)

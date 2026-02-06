import { Static, Type } from '@sinclair/typebox'
import { PropertyDataType, PropertyDefs, StorageType } from '@/types'
import { TValidationRules } from '@/Schema/validation'

/**
 * Enum for all property data types
 */
export enum ModelPropertyDataTypes {
  Text = 'Text',
  Number = 'Number',
  List = 'List',
  Relation = 'Relation',
  Image = 'Image',
  Json = 'Json',
  File = 'File',
  Boolean = 'Boolean',
  Date = 'Date',
  Html = 'Html',
}

export const TPropertyDataType = Type.Union([
  Type.Literal(ModelPropertyDataTypes.Text),
  Type.Literal(ModelPropertyDataTypes.Number),
  Type.Literal(ModelPropertyDataTypes.List),
  Type.Literal(ModelPropertyDataTypes.Relation),
  Type.Literal(ModelPropertyDataTypes.Image),
  Type.Literal(ModelPropertyDataTypes.Json),
  Type.Literal(ModelPropertyDataTypes.File),
  Type.Literal(ModelPropertyDataTypes.Boolean),
  Type.Literal(ModelPropertyDataTypes.Date),
  Type.Literal(ModelPropertyDataTypes.Html),
])

export const TStorageType = Type.Union([
  Type.Literal('ItemStorage'), // Looks for a storageTransactionId property on the item
  Type.Literal('PropertyStorage'), // Looks for a storageTransactionId value on the property
])

export const TProperty = Type.Object({
  id: Type.Optional(Type.String()), // schemaFileId (string) - public ID
  _dbId: Type.Optional(Type.Number()), // Database integer ID - internal only
  name: Type.Optional(Type.String()),
  dataType: TPropertyDataType,
  ref: Type.Optional(Type.String()),
  // modelId: string (modelFileId) in code; number only for DB foreign keys when resolved
  modelId: Type.Optional(Type.Union([Type.Number(), Type.String()])),
  modelName: Type.Optional(Type.String()),
  refModelId: Type.Optional(Type.Number()),
  refModelName: Type.Optional(Type.String()),
  refValueType: Type.Optional(TPropertyDataType),
  storageType: Type.Optional(TStorageType),
  localStorageDir: Type.Optional(Type.String()),
  filenameSuffix: Type.Optional(Type.String()),
  validation: Type.Optional(TValidationRules),
})

export const TPropertyConstructor = Type.Function(
  [
    Type.Optional(Type.Union([Type.String(), TStorageType, Type.Undefined()])),
    Type.Optional(Type.Union([Type.String(), TPropertyDataType])),
    Type.Optional(Type.String()),
  ],
  TProperty,
)

export const TPropertyDefs = Type.Record(
  TPropertyDataType,
  TPropertyConstructor,
)

export const Property = {
  Text: (
    storageType?: StorageType,
    localStorageDir?: string,
    filenameSuffix?: string,
  ) => ({
    dataType: ModelPropertyDataTypes.Text,
    storageType,
    localStorageDir,
    filenameSuffix,
    TObject: Type.String(),
  }),
  Json: () => ({ dataType: ModelPropertyDataTypes.Json }),
  File: () => ({ dataType: ModelPropertyDataTypes.File }),
  Number: () => ({ dataType: ModelPropertyDataTypes.Number }),
  List: (ref: string, refValueType?: PropertyDataType) => ({
    dataType: ModelPropertyDataTypes.List,
    ref,
    refValueType,
  }),
  Relation: (ref?: string, refValueType?: PropertyDataType) => ({
    dataType: ModelPropertyDataTypes.Relation,
    ref,
    refValueType,
  }),
  Image: () => ({ dataType: ModelPropertyDataTypes.Image }),
  Boolean: () => ({ dataType: ModelPropertyDataTypes.Boolean }),
  Date: () => ({ dataType: ModelPropertyDataTypes.Date }),
  Html: () => ({ dataType: ModelPropertyDataTypes.Html }),
} as PropertyDefs

export const PropertyMetadataKey = Symbol('property')

export const PropertyConstructor = (propertyType: Static<typeof TProperty>) => {
  return function (parentClassPrototype: any, propertyKey: string) {
    const existingProperties =
      Reflect.getMetadata(PropertyMetadataKey, parentClassPrototype) || []

    existingProperties.push({ propertyKey, propertyType })
    // console.log('existingProperties', existingProperties)
    // console.log('propertyKey', propertyKey)
    // console.log('propertyType', propertyType)
    // console.log('PropertyMetadataKey', PropertyMetadataKey)
    // console.log('typeof target', typeof target)
    Reflect.defineMetadata(
      PropertyMetadataKey,
      existingProperties,
      parentClassPrototype,
    )
    // console.log(
    //   `After adding ${propertyKey}:`,
    //   Reflect.getMetadata(PropertyMetadataKey, parentClassPrototype),
    // )
  }
}

export const Text = (
  storageType?: StorageType,
  srcDir?: string,
  filenameSuffix?: string,
) => PropertyConstructor(Property.Text(storageType, srcDir, filenameSuffix))
export const Number = () => PropertyConstructor(Property.Number())
export const Json  = () => PropertyConstructor(Property.Json())
export const File  = () => PropertyConstructor(Property.File())
export const Image = () => PropertyConstructor(Property.Image())
export const Relation = (ref: string, refValueType?: PropertyDataType) =>
  PropertyConstructor(Property.Relation(ref, refValueType)) // Adjust for actual relation type
export const List = (ref: string, reValueType?: PropertyDataType) =>
  PropertyConstructor(Property.List(ref, reValueType)) // Adjust for actual list type
export const Boolean = () => PropertyConstructor(Property.Boolean())
export const Date = () => PropertyConstructor(Property.Date())

import { Static, Type } from '@sinclair/typebox'
import { PropertyDataType, PropertyDefs, StorageType } from '@/types'

export * from './ItemProperty'

export const TPropertyDataType = Type.Union([
  Type.Literal('Text'),
  Type.Literal('Number'),
  Type.Literal('List'),
  Type.Literal('Relation'),
  Type.Literal('ImageSrc'),
  Type.Literal('FileSrc'),
  Type.Literal('Json'),
  Type.Literal('Blob'),
])

export const TStorageType = Type.Union([
  Type.Literal('ItemStorage'), // Looks for a storageTransactionId property on the item
  Type.Literal('PropertyStorage'), // Looks for a storageTransactionId value on the property
])

export const TProperty = Type.Object({
  id: Type.Optional(Type.Number()),
  name: Type.Optional(Type.String()),
  dataType: TPropertyDataType,
  ref: Type.Optional(Type.String()),
  modelId: Type.Optional(Type.Number()),
  refModelId: Type.Optional(Type.Number()),
  refValueType: Type.Optional(TPropertyDataType),
  storageType: Type.Optional(TStorageType),
  localStorageDir: Type.Optional(Type.String()),
  filenameSuffix: Type.Optional(Type.String()),
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

export const Property: PropertyDefs = {
  Text: (
    storageType?: StorageType,
    localStorageDir?: string,
    filenameSuffix?: string,
  ) => ({
    dataType: 'Text',
    storageType,
    localStorageDir,
    filenameSuffix,
    TObject: Type.String(),
  }),
  Json: () => ({ dataType: 'Json' }),
  Blob: () => ({ dataType: 'Blob' }),
  Number: () => ({ dataType: 'Number' }),
  List: (ref: string, refValueType?: PropertyDataType) => ({
    dataType: 'List',
    ref,
    refValueType,
  }),
  Relation: (ref, refValueType?: PropertyDataType) => ({
    dataType: 'Relation',
    ref,
    refValueType,
  }),
  ImageSrc: () => ({ dataType: 'ImageSrc' }),
}

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
export const Json = () => PropertyConstructor(Property.Json())
export const Blob = () => PropertyConstructor(Property.Blob())
export const ImageSrc = () => PropertyConstructor(Property.ImageSrc())
export const Relation = (ref: string, refValueType?: PropertyDataType) =>
  PropertyConstructor(Property.Relation(ref, refValueType)) // Adjust for actual relation type
export const List = (ref: string, reValueType?: PropertyDataType) =>
  PropertyConstructor(Property.List(ref, reValueType)) // Adjust for actual list type

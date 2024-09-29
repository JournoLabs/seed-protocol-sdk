import { Static, Type } from '@sinclair/typebox'
import { PropertyDefs } from '@/types'

export * from './class'

export const TPropertyDataType = Type.Union([
  Type.Literal('Text'),
  Type.Literal('Number'),
  Type.Literal('List'),
  Type.Literal('Relation'),
  Type.Literal('ImageSrc'),
  Type.Literal('Json'),
  Type.Literal('Blob'),
])

export const TProperty = Type.Object({
  id: Type.Optional(Type.Number()),
  name: Type.Optional(Type.String()),
  dataType: TPropertyDataType,
  ref: Type.Optional(Type.String()),
  modelId: Type.Optional(Type.Number()),
  refModelId: Type.Optional(Type.Number()),
})

export const TPropertyConstructor = Type.Function(
  [Type.Optional(Type.String()), Type.Optional(Type.String())],
  TProperty,
)

export const TPropertyDefs = Type.Record(
  TPropertyDataType,
  TPropertyConstructor,
)

export const Property: PropertyDefs = {
  Text: () => ({
    dataType: 'Text',
    TObject: Type.String(),
  }),
  Json: () => ({ dataType: 'Json' }),
  Blob: () => ({ dataType: 'Blob' }),
  Number: () => ({ dataType: 'Number' }),
  List: (ref, refValueType?) => ({ dataType: 'List', ref, refValueType }),
  Relation: (ref, refValueType?) => ({
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
    Reflect.defineMetadata(
      PropertyMetadataKey,
      existingProperties,
      parentClassPrototype,
    )
  }
}

export const Text = () => PropertyConstructor(Property.Text())
export const Number = () => PropertyConstructor(Property.Number())
export const Json = () => PropertyConstructor(Property.Json())
export const Blob = () => PropertyConstructor(Property.Blob())
export const ImageSrc = () => PropertyConstructor(Property.ImageSrc())
export const Relation = (ref: string, refValueType?: string) =>
  PropertyConstructor(Property.Relation(ref, refValueType)) // Adjust for actual relation type
export const List = (ref: string, reValueType?: string) =>
  PropertyConstructor(Property.List(ref, reValueType)) // Adjust for actual list type

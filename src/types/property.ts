import { Static }                   from '@sinclair/typebox'
import { TProperty, TPropertyDefs } from '@/browser/schema'

export type ItemPropertyProps = {
  propertyName?: string
  propertyRecordSchema: PropertyType | string
  initialValue?: any
  seedUid?: string
  seedLocalId?: string
  itemModelName: string
  schemaUid?: string
}

export type PropertyDefs = Static<typeof TPropertyDefs>

export type PropertyType = Static<typeof TProperty>

import { describe, it, expect } from 'vitest'
import { SchemaValidationService } from '@/Schema/service/validation/SchemaValidationService'
import { ModelPropertyDataTypes } from '@/helpers/property'
import { getSegmentedItemProperties } from '@/helpers/getSegmentedItemProperties'
import type { IItem, IItemProperty } from '@/interfaces'

describe('List-only multi-value restriction', () => {
  describe('validatePropertyStructure', () => {
    const schema = new SchemaValidationService()

    it('rejects array values for non-List dataTypes', () => {
      const result = schema.validatePropertyValue([1, 2, 3], ModelPropertyDataTypes.Number)
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.code === 'array_not_allowed')).toBe(true)
    })

    it('rejects array for Text', () => {
      const result = schema.validatePropertyValue(['a', 'b'], ModelPropertyDataTypes.Text)
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.code === 'array_not_allowed')).toBe(true)
    })

    it('rejects array for Relation', () => {
      const result = schema.validatePropertyValue(['id1', 'id2'], ModelPropertyDataTypes.Relation)
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.code === 'array_not_allowed')).toBe(true)
    })

    it('accepts array for List', () => {
      const result = schema.validatePropertyValue(['a', 'b'], ModelPropertyDataTypes.List)
      expect(result.isValid).toBe(true)
    })

    it('rejects List without refValueType', () => {
      const result = schema.validatePropertyStructure({
        dataType: ModelPropertyDataTypes.List,
        name: 'tags',
      } as any)
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.code === 'missing_ref_value_type')).toBe(true)
    })

    it('rejects List of relations without ref', () => {
      const result = schema.validatePropertyStructure({
        dataType: ModelPropertyDataTypes.List,
        refValueType: ModelPropertyDataTypes.Relation,
        name: 'tags',
      } as any)
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.code === 'missing_ref')).toBe(true)
    })

    it('accepts List with refValueType Text and no ref', () => {
      const result = schema.validatePropertyStructure({
        dataType: ModelPropertyDataTypes.List,
        refValueType: ModelPropertyDataTypes.Text,
        name: 'keywords',
      } as any)
      expect(result.isValid).toBe(true)
    })

    it('accepts List with refValueType Relation and ref', () => {
      const result = schema.validatePropertyStructure({
        dataType: ModelPropertyDataTypes.List,
        refValueType: ModelPropertyDataTypes.Relation,
        ref: 'Tag',
        name: 'tags',
      } as any)
      expect(result.isValid).toBe(true)
    })

    it('rejects refValueType on non-List types (except Relation+Image)', () => {
      const result = schema.validatePropertyStructure({
        dataType: ModelPropertyDataTypes.Text,
        refValueType: ModelPropertyDataTypes.Text,
        name: 'keywords',
      } as any)
      expect(result.isValid).toBe(false)
      expect(result.errors.some((e) => e.code === 'invalid_ref_value_type')).toBe(true)
    })

    it('allows Relation with refValueType Image', () => {
      const result = schema.validatePropertyStructure({
        dataType: ModelPropertyDataTypes.Relation,
        ref: 'Image',
        refValueType: ModelPropertyDataTypes.Image,
        name: 'coverImage',
      } as any)
      expect(result.isValid).toBe(true)
    })
  })

  describe('getSegmentedItemProperties', () => {
    const createMockItemProperty = (
      dataType: string,
      ref?: string
    ): IItemProperty<any> =>
      ({
        propertyName: 'test',
        propertyDef: { dataType, ref },
      }) as IItemProperty<any>

    it('splits list-of-relations to itemListProperties', () => {
      const item = {
        properties: [
          createMockItemProperty(ModelPropertyDataTypes.List, 'Tag'),
        ],
      } as IItem<any>
      const { itemListProperties, itemBasicProperties } = getSegmentedItemProperties(item)
      expect(itemListProperties).toHaveLength(1)
      expect(itemBasicProperties).toHaveLength(0)
    })

    it('splits list-of-primitives to itemBasicProperties', () => {
      const item = {
        properties: [
          createMockItemProperty(ModelPropertyDataTypes.List),
        ],
      } as IItem<any>
      const { itemListProperties, itemBasicProperties } = getSegmentedItemProperties(item)
      expect(itemListProperties).toHaveLength(0)
      expect(itemBasicProperties).toHaveLength(1)
    })
  })
})

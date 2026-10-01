import { describe, it, expect } from 'vitest'
import {
  ModelPropertyDataTypes,
  isDataType,
  normalizePropertyRecordSchema,
} from '@/helpers/property'

describe('isDataType', () => {
  it('matches regardless of case', () => {
    expect(isDataType('list', ModelPropertyDataTypes.List)).toBe(true)
    expect(isDataType('LIST', ModelPropertyDataTypes.List)).toBe(true)
    expect(isDataType('List', ModelPropertyDataTypes.List)).toBe(true)
    expect(isDataType('html', 'Html')).toBe(true)
  })

  it('rejects other types and empty values', () => {
    expect(isDataType('Relation', ModelPropertyDataTypes.List)).toBe(false)
    expect(isDataType(undefined, ModelPropertyDataTypes.List)).toBe(false)
    expect(isDataType(null, ModelPropertyDataTypes.List)).toBe(false)
    expect(isDataType('', ModelPropertyDataTypes.List)).toBe(false)
  })
})

describe('normalizePropertyRecordSchema', () => {
  it('maps schema-file `type` to dataType', () => {
    expect(normalizePropertyRecordSchema({ id: 'abc', type: 'html' })).toMatchObject({
      id: 'abc',
      dataType: 'Html',
    })
  })

  it('normalizes lowercase list of relations', () => {
    expect(
      normalizePropertyRecordSchema({ dataType: 'list', refValueType: 'relation', ref: 'Identity' }),
    ).toMatchObject({ dataType: 'List', refValueType: 'Relation', ref: 'Identity' })
  })

  it('derives Relation refValueType for a list with a model ref', () => {
    expect(normalizePropertyRecordSchema({ type: 'List', items: { model: 'Tag' } })).toMatchObject({
      dataType: 'List',
      refValueType: 'Relation',
      ref: 'Tag',
    })
  })

  it('maps storage config', () => {
    expect(
      normalizePropertyRecordSchema({
        type: 'Text',
        storage: { type: 'ItemStorage', path: '/html', extension: '.html' },
      }),
    ).toMatchObject({ storageType: 'ItemStorage', localStorageDir: '/html', filenameSuffix: '.html' })
  })

  it('passes through undefined', () => {
    expect(normalizePropertyRecordSchema(undefined)).toBeUndefined()
  })
})

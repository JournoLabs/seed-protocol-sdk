import { describe, it, expect } from 'vitest'
import { getSchemaNameFromId } from '@/helpers/schema'

describe('getSchemaNameFromId', () => {
  it('strips a numeric version suffix', () => {
    expect(getSchemaNameFromId('Blog-1')).toBe('Blog')
    expect(getSchemaNameFromId('my-app-12')).toBe('my-app')
  })

  it('keeps hyphenated names that have no version suffix', () => {
    expect(getSchemaNameFromId('my-app')).toBeNull()
    expect(getSchemaNameFromId('Blog')).toBeNull()
    expect(getSchemaNameFromId(undefined)).toBeNull()
  })
})

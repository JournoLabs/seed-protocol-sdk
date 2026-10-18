import { describe, expect, it } from 'vitest'
import { getStorageSubdirForDataType } from '@/helpers/storageDir'

describe('getStorageSubdirForDataType', () => {
  it('maps the storage data types, case-insensitively', () => {
    expect(getStorageSubdirForDataType('Image')).toBe('images')
    expect(getStorageSubdirForDataType('image')).toBe('images')
    expect(getStorageSubdirForDataType('File')).toBe('files')
    expect(getStorageSubdirForDataType('Html')).toBe('html')
    expect(getStorageSubdirForDataType('json')).toBe('json')
  })

  it('sends unknown or missing types to files/, not images/', () => {
    expect(getStorageSubdirForDataType('Video')).toBe('files')
    expect(getStorageSubdirForDataType('Text')).toBe('files')
    expect(getStorageSubdirForDataType('')).toBe('files')
    expect(getStorageSubdirForDataType(undefined)).toBe('files')
  })
})

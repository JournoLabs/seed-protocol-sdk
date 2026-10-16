import { describe, expect, test } from 'bun:test'
import { assertUploadApiBaseUrl } from './config'

describe('assertUploadApiBaseUrl', () => {
  test('requires it when the operator pays for storage (the default)', () => {
    expect(() => assertUploadApiBaseUrl({} as never)).toThrow('uploadApiBaseUrl is required')
    expect(() => assertUploadApiBaseUrl({ uploadApiBaseUrl: '  ' } as never)).toThrow('uploadApiBaseUrl is required')
    expect(() =>
      assertUploadApiBaseUrl({ uploadApiBaseUrl: '', payment: { storage: 'operator' } } as never),
    ).toThrow('uploadApiBaseUrl is required')
  })

  test('is optional when users pay for storage', () => {
    expect(() => assertUploadApiBaseUrl({ payment: { storage: 'user' } } as never)).not.toThrow()
  })

  test('must be an absolute http(s) URL, or a path from the origin, when set', () => {
    expect(() => assertUploadApiBaseUrl({ uploadApiBaseUrl: 'localhost:3000' } as never)).toThrow('absolute http(s) URL')
    expect(() => assertUploadApiBaseUrl({ uploadApiBaseUrl: 'ftp://files.example.com' } as never)).toThrow('absolute http(s) URL')
    expect(() => assertUploadApiBaseUrl({ uploadApiBaseUrl: '/seed-api' } as never)).not.toThrow()
    expect(() => assertUploadApiBaseUrl({ uploadApiBaseUrl: 'http://127.0.0.1:1984' } as never)).not.toThrow()
    expect(() => assertUploadApiBaseUrl({ uploadApiBaseUrl: 'https://upload.example.com' } as never)).not.toThrow()
  })
})

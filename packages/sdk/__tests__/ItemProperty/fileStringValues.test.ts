import { describe, it, expect, beforeAll } from 'vitest'
import { classifyFileString } from '@/ItemProperty/service/actors/saveValueToDb/saveFile'
import { setupTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/** Strings assigned to File properties: only data URLs are decoded and only real URLs fetched. */
describe('classifyFileString', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  const text = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes)

  it('decodes base64 and plain data URLs', async () => {
    const base64 = await classifyFileString('data:text/plain;base64,aGVsbG8=')
    expect(base64.kind).toBe('dataUrl')
    expect(text((base64 as { bytes: ArrayBuffer }).bytes)).toBe('hello')

    const plain = await classifyFileString('data:application/json,%7B%22a%22%3A1%7D')
    expect(text((plain as { bytes: ArrayBuffer }).bytes)).toBe('{"a":1}')
  })

  it('treats plain strings as text, even ones that look like base64 or file names', async () => {
    expect((await classifyFileString('hello')).kind).toBe('text')
    expect((await classifyFileString('photo.jpg')).kind).toBe('text')
    expect((await classifyFileString('some notes, with punctuation.')).kind).toBe('text')
  })

  it('fetches only http(s) and blob URLs', async () => {
    expect((await classifyFileString('https://example.com/a.pdf')).kind).toBe('url')
    expect((await classifyFileString('blob:https://example.com/123')).kind).toBe('url')
  })
})

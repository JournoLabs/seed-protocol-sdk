import { describe, expect, it } from 'vitest'
import { parseJsonImportContent } from '@/imports/json'

const models = { Post: { properties: { title: { type: 'Text' } } } }

describe('parseJsonImportContent', () => {
  it('reads metadata.name from a complete schema file', () => {
    const content = JSON.stringify({ $schema: 'https://seedprotocol.io/schemas/data-model/v1', metadata: { name: 'blog' }, models })
    expect(parseJsonImportContent(content).name).toBe('blog')
  })

  it('reads the top-level name from the minimal format', () => {
    expect(parseJsonImportContent(JSON.stringify({ name: 'blog', models })).name).toBe('blog')
  })

  it('reads metadata.name from a schema file without $schema', () => {
    expect(parseJsonImportContent(JSON.stringify({ metadata: { name: 'blog' }, models })).name).toBe('blog')
  })

  it('rejects a schema with no name', () => {
    expect(() => parseJsonImportContent(JSON.stringify({ models }))).toThrow('Schema name is required')
  })
})

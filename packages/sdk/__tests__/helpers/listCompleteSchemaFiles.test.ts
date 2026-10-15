import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { listCompleteSchemaFiles } from '@/helpers/schema'

/**
 * Schema files are named `{schemaFileId}_{schemaName}_v{version}.json`, with spaces in the name
 * replaced by underscores. Generated ids have no underscores, so the id is everything before the
 * first one. A multi-word name ("Test Schema Latest") used to be parsed with a greedy id group,
 * giving schemaFileId "abc123_Test_Schema".
 */
const WORKING_DIR = '/app'

const completeSchema = (id: string, name: string, version: number) =>
  JSON.stringify({
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version,
    id,
    metadata: { name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    models: {},
    enums: {},
    migrations: [],
  })

const stubFiles = (files: Record<string, string>) => {
  vi.spyOn(BaseFileManager, 'getWorkingDir').mockReturnValue(WORKING_DIR)
  vi.spyOn(BaseFileManager, 'getPathModule').mockReturnValue({
    join: (...parts: string[]) => parts.join('/'),
  })
  vi.spyOn(BaseFileManager, 'getFs').mockResolvedValue({
    promises: { readdir: async () => Object.keys(files) },
  })
  vi.spyOn(BaseFileManager, 'pathExists').mockResolvedValue(true)
  vi.spyOn(BaseFileManager, 'readFileAsString').mockImplementation(async (filePath: string) => {
    const content = files[filePath.slice(WORKING_DIR.length + 1)]
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`)
    return content
  })
}

describe('listCompleteSchemaFiles', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses the schemaFileId of a multi-word schema name up to the first underscore', async () => {
    stubFiles({
      'abc123_Test_Schema_Latest_v1.json': completeSchema('abc123', 'Test Schema Latest', 1),
      'def456_Test_Schema_Latest_v2.json': completeSchema('def456', 'Test Schema Latest', 2),
    })

    const schemas = await listCompleteSchemaFiles()

    expect(schemas).toEqual(
      expect.arrayContaining([
        {
          name: 'Test Schema Latest',
          version: 1,
          filePath: `${WORKING_DIR}/abc123_Test_Schema_Latest_v1.json`,
          schemaFileId: 'abc123',
        },
        {
          name: 'Test Schema Latest',
          version: 2,
          filePath: `${WORKING_DIR}/def456_Test_Schema_Latest_v2.json`,
          schemaFileId: 'def456',
        },
      ]),
    )
    expect(schemas).toHaveLength(2)
  })

  it('parses a single-word schema name', async () => {
    stubFiles({ 'xyz789_Blog_v3.json': completeSchema('xyz789', 'Blog', 3) })

    const [schema] = await listCompleteSchemaFiles()

    expect(schema).toMatchObject({ name: 'Blog', version: 3, schemaFileId: 'xyz789' })
  })

  it('skips files that are not complete schema files', async () => {
    stubFiles({
      'abc123_Notes_v1.json': JSON.stringify({ name: 'Notes', models: {} }),
      'notes.txt': 'not a schema',
    })

    expect(await listCompleteSchemaFiles()).toEqual([])
  })
})

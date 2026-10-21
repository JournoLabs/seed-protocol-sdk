import { BaseFileManager } from './FileManager/BaseFileManager'
import { SchemaFileFormat } from '@/types/import'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import debug from 'debug'

const logger = debug('seedSdk:helpers:schema')

/** Filesystem-safe schema name: other characters become `_`, runs of `_` collapse, ends trimmed. */
const sanitizeSchemaName = (name: string): string =>
  name
    .replace(/[^a-zA-Z0-9\s_-]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

/**
 * A schema version file's name: `<schemaFileId>_<name>_v<version>.json` (ADR 0016). The id comes
 * first, so a schema's versions sort together and a rename keeps them under one id.
 */
export const getSchemaFileName = (schemaFileId: string, name: string, version: number): string =>
  `${schemaFileId}_${sanitizeSchemaName(name)}_v${version}.json`

/** The path of a schema version file in the working directory. */
export const getSchemaFilePath = (schemaFileId: string, name: string, version: number): string =>
  BaseFileManager.getPathModule().join(
    BaseFileManager.getWorkingDir(),
    getSchemaFileName(schemaFileId, name, version),
  )

// Ids have no underscores but names can ("My_Schema"), so the id group stops at the first one
const SCHEMA_FILE_NAME = /^(.+?)_(.+)_v(\d+)\.json$/

/**
 * Some tools write `models` and each model's `properties` as arrays. Returns them as objects keyed
 * by name (or id, or index).
 */
export function normalizeSchemaModels(models: SchemaFileFormat['models'] | unknown): SchemaFileFormat['models'] {
  if (!models || typeof models !== 'object') return {}
  if (!Array.isArray(models)) return models as SchemaFileFormat['models']

  const result: SchemaFileFormat['models'] = {}
  for (let i = 0; i < models.length; i++) {
    const m = models[i] as any
    const key = m?.name ?? m?.id ?? String(i)
    const props = m?.properties
    let properties: Record<string, any> = {}
    if (Array.isArray(props)) {
      for (let j = 0; j < props.length; j++) {
        const p = props[j] as any
        properties[p?.name ?? p?.id ?? String(j)] = p
      }
    } else if (props && typeof props === 'object') {
      properties = props
    }
    result[key] = { ...m, properties }
  }
  return result
}

/** The complete schema file at filePath, or undefined when it can't be read or has no `$schema`. */
export async function readSchemaFile(filePath: string): Promise<SchemaFileFormat | undefined> {
  try {
    const schema = JSON.parse(await BaseFileManager.readFileAsString(filePath)) as SchemaFileFormat
    if (!schema?.$schema) return undefined
    schema.models = normalizeSchemaModels(schema.models)
    return schema
  } catch (error) {
    logger(`Could not read schema file ${filePath}:`, error)
    return undefined
  }
}

type CompleteSchemaFileInfo = { name: string; version: number; filePath: string; schemaFileId?: string }

/**
 * Every complete schema file (`<id>_<name>_v<n>.json` with `$schema` and `metadata.name`) in the
 * working directory. The id is taken from the file name.
 */
export async function listCompleteSchemaFiles(): Promise<CompleteSchemaFileInfo[]> {
  const fs = await BaseFileManager.getFs()
  const path = BaseFileManager.getPathModule()
  const workingDir = BaseFileManager.getWorkingDir()

  try {
    if (!(await BaseFileManager.pathExists(workingDir))) {
      logger(`Working directory does not exist yet: ${workingDir}, returning empty schema list`)
      return []
    }

    const files = await fs.promises.readdir(workingDir)
    const schemas: CompleteSchemaFileInfo[] = []
    for (const file of files) {
      const match = file.match(SCHEMA_FILE_NAME)
      if (!match) continue
      const [, schemaFileId, , versionStr] = match
      const version = parseInt(versionStr, 10)
      if (isNaN(version)) continue
      const filePath = path.join(workingDir, file)
      try {
        const data = JSON.parse(await BaseFileManager.readFileAsString(filePath)) as any
        if (data.$schema && data.metadata?.name) {
          schemas.push({ name: data.metadata.name, version: data.version || version, filePath, schemaFileId })
        }
      } catch {
        continue
      }
    }
    return schemas
  } catch (error) {
    throw new Error(`Failed to list complete schemas: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** The newest file of each schema, by schema file id (a schema's name can change between versions). */
export async function listLatestSchemaFiles(): Promise<CompleteSchemaFileInfo[]> {
  const latest = new Map<string, CompleteSchemaFileInfo>()
  for (const file of await listCompleteSchemaFiles()) {
    const key = file.schemaFileId ?? file.name
    const existing = latest.get(key)
    if (!existing || file.version > existing.version) latest.set(key, file)
  }
  return [...latest.values()]
}

/** The newest version file of the schema with this file id, if any. */
export async function findLatestSchemaFile(schemaFileId: string): Promise<CompleteSchemaFileInfo | undefined> {
  return (await listLatestSchemaFiles()).find((file) => file.schemaFileId === schemaFileId)
}

/**
 * One loaded schema: its definition from {@link resolveSchemaRow}, and the row it came from.
 */
export type LoadedSchema = {
  schema: SchemaFileFormat
  isDraft: boolean
  source: 'db' | 'db+file'
  schemaRecordId?: number
  /** The version file the definition was read from (source 'db+file'). */
  filePath?: string
}

/**
 * Every schema row in the database, each resolved to its definition by {@link resolveSchemaRow}.
 * Reads only: schema files without a row are applied at init (processSchemaFiles), not here.
 */
export async function loadAllSchemasFromDb(): Promise<LoadedSchema[]> {
  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not found')
  }
  const { resolveSchemaRow } = await import('./schemaApply')
  const rows = await db.select().from(schemasTable).orderBy(schemasTable.name)
  const result: LoadedSchema[] = []
  for (const row of rows) {
    try {
      const resolved = await resolveSchemaRow(row)
      if (!resolved) continue
      result.push({
        schema: resolved.schema,
        isDraft: row.isDraft === true,
        source: resolved.filePath ? 'db+file' : 'db',
        schemaRecordId: row.id ?? undefined,
        filePath: resolved.filePath,
      })
    } catch (error) {
      logger(`Error resolving schema row ${row.name}:`, error)
    }
  }
  return result
}

/**
 * Extract the schema name from a schemaId string
 * @param schemaId - Schema ID in the format `${schemaName}-${schemaVersion}`
 * @returns The schema name, or null if the format is invalid
 */
export function getSchemaNameFromId(schemaId: string | null | undefined): string | null {
  if (!schemaId) {
    return null
  }
  // Only a numeric version suffix: names may contain hyphens ("my-app" must stay "my-app").
  const match = /^(.+)-(\d+)$/.exec(schemaId)
  return match ? match[1] : null
}

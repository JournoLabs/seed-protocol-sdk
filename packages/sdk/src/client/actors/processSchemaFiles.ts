import { ClientManagerContext } from "@/types/machines"
import { isInternalSchema } from "@/helpers/constants"
import { listLatestSchemaFiles, loadAllSchemasFromDb, readSchemaFile } from "@/helpers/schema"
import { applySchemaFile, createModelsForSchemaFile } from "@/helpers/schemaApply"
import { BaseDb } from "@/db/Db/BaseDb"
import { schemas as schemasTable } from "@/seedSchema/SchemaSchema"
import { importJsonSchema, syncSchemaFromSource } from "@/imports/json"
import { SchemaFileFormat } from "@/types/import"
import { BaseFileManager } from "@/helpers/FileManager/BaseFileManager"
import { isNode } from "@/helpers/environment"
import { withSeedDbLock } from "@/helpers/tabLocks"
import debug from "debug"
import internalSchema from "@/seedSchema/SEEDPROTOCOL_Seed_Protocol_v1.json"

const logger = debug('seedSdk:client:actors:processSchemaFiles')

let processSchemaFilesChain: Promise<void> = Promise.resolve()

function resolveSchemaFilePath(schemaFile: string): string {
  const path = BaseFileManager.getPathModule()
  if (path.isAbsolute(schemaFile)) {
    return schemaFile
  }
  if (isNode()) {
    return path.resolve(process.cwd(), schemaFile)
  }
  const workingDir = BaseFileManager.getWorkingDir()
  return path.join(workingDir, schemaFile)
}

/** Error for a schema the app passed in config, so init fails with what went wrong and where. */
function userSchemaLoadError(option: 'schema' | 'schemaFile', source: unknown, error: unknown): Error {
  const where = typeof source === 'string' ? ` from "${source}"` : ''
  const reason = error instanceof Error ? error.message : String(error)
  return new Error(`Could not load config.${option}${where}: ${reason}`, { cause: error })
}

/**
 * The schema step of init: applies the internal schema, the app's `config.schema` (or
 * `config.schemaFile`) and any version file not yet applied, then returns Model instances for every
 * schema in the database. An input whose file id, version and content the rows already record is
 * not written again.
 */
export async function processSchemaFilesOnce(
  context: Pick<ClientManagerContext, 'schema' | 'schemaFile' | 'models'>,
): Promise<{ [modelName: string]: any }> {
  const appliedNames = new Set<string>()

  try {
    const applied = await applySchemaFile(internalSchema as SchemaFileFormat, { store: false })
    appliedNames.add(applied.schemaFile.metadata.name)
  } catch (error) {
    logger('Error loading internal seed-protocol schema:', error)
  }

  // The app's schema (canonical) takes precedence over schemaFile
  if (context.schema) {
    const schemaName = typeof context.schema === 'object' ? String(context.schema?.metadata?.name ?? '') : ''
    const schemaId = typeof context.schema === 'object' && context.schema?.id ? String(context.schema.id) : undefined
    if (!isInternalSchema(schemaName, schemaId)) {
      try {
        await syncSchemaFromSource(context.schema)
        if (schemaName) appliedNames.add(schemaName)
      } catch (error: any) {
        // A schema the app passed in failed (missing file, bad JSON, DB write). Re-running an
        // unchanged schema does not throw, so this is not the already-loaded case: fail init.
        throw userSchemaLoadError('schema', context.schema, error)
      }
    }
  } else if (context.schemaFile) {
    try {
      const content = await BaseFileManager.readFileAsString(resolveSchemaFilePath(context.schemaFile))
      await importJsonSchema({ contents: content })
      const name = (JSON.parse(content) as SchemaFileFormat)?.metadata?.name
      if (name) appliedNames.add(String(name))
    } catch (error: any) {
      throw userSchemaLoadError('schemaFile', context.schemaFile, error)
    }
  }

  await applyPendingSchemaFiles(appliedNames)

  // Model instances for every schema; their rows are written, so they adopt them
  const allModels: { [key: string]: any } = { ...(context.models || {}) }
  let loaded: Awaited<ReturnType<typeof loadAllSchemasFromDb>> = []
  try {
    loaded = await loadAllSchemasFromDb()
  } catch (error) {
    logger('Error loading schemas from database (continuing anyway):', error)
  }
  for (const { schema } of loaded) {
    try {
      Object.assign(allModels, await createModelsForSchemaFile(schema))
    } catch (error) {
      logger(`Error creating models for schema ${schema.metadata?.name}:`, error)
    }
  }

  return allModels
}

/**
 * Init step: runs processSchemaFilesOnce under the init lock and returns the models it loaded.
 * Runs one at a time: its schema and model inserts check for rows first, so tabs take turns
 * (docs/MULTI_TAB.md), and so do overlapping inits in this tab.
 */
export function processSchemaFiles(context: ClientManagerContext): Promise<{ [modelName: string]: any }> {
  logger('processSchemaFiles started')
  const run = processSchemaFilesChain.then(() =>
    withSeedDbLock('init', context.filesDir, () => processSchemaFilesOnce(context)),
  )
  // The chain only orders runs; a failed run must not fail the next init too.
  processSchemaFilesChain = run.then(
    () => {},
    () => {},
  )
  return run
}

/**
 * Applies each schema's newest version file that its row hasn't applied: no row with the file's
 * id, or a published row at an older version. Drafts keep their edits. A file named like a schema
 * this init applied under another id is skipped (an earlier id's leftover).
 */
async function applyPendingSchemaFiles(appliedNames: Set<string>): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  let files: Awaited<ReturnType<typeof listLatestSchemaFiles>> = []
  try {
    files = await listLatestSchemaFiles()
  } catch (error) {
    logger('Error listing schema files (continuing anyway):', error)
    return
  }
  const rows = await db
    .select({ schemaFileId: schemasTable.schemaFileId, version: schemasTable.version, isDraft: schemasTable.isDraft })
    .from(schemasTable)
  const rowById = new Map(rows.map((row: { schemaFileId: string | null }) => [row.schemaFileId, row]))
  for (const info of files) {
    if (isInternalSchema(info.name, info.schemaFileId)) continue
    const row = rowById.get(info.schemaFileId ?? null) as { version: number; isDraft: boolean | null } | undefined
    if (row ? row.isDraft || row.version >= info.version : appliedNames.has(info.name)) continue
    try {
      const file = await readSchemaFile(info.filePath)
      if (file) await applySchemaFile({ ...file, id: file.id ?? info.schemaFileId }, { store: false })
    } catch (error) {
      logger(`Error applying schema file ${info.filePath}:`, error)
    }
  }
}

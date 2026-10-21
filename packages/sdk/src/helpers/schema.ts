import { BaseFileManager } from './FileManager/BaseFileManager'
import { SchemaFileFormat } from '@/types/import'
import { BaseDb } from '@/db/Db/BaseDb'
import { addSchemaToDb, loadModelsFromDbForSchema } from '@/helpers/db'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { isInternalSchema } from '@/helpers/constants'
import { desc } from 'drizzle-orm'
import debug from 'debug'

const logger = debug('seedSdk:helpers:schema')

/**
 * List all schema files in the working directory
 * Only returns files that are NOT already complete schema files (i.e., files without $schema field)
 * This allows processing of minimal import files while skipping already-processed schema files
 * @returns Array of objects containing name, version, and file path for each schema
 */
export async function listSchemaFiles(): Promise<Array<{ name: string; version: number; filePath: string }>> {
  const fs = await BaseFileManager.getFs()
  const path = BaseFileManager.getPathModule()

  // Check if working directory exists
  const workingDir = BaseFileManager.getWorkingDir()

  try {
    const files = await fs.promises.readdir(workingDir)
    const schemas: Array<{ name: string; version: number; filePath: string }> = []

    for (const file of files) {
      // Match filename pattern: {name}-v{version}.json
      const match = file.match(/^(.+)-v(\d+)\.json$/)
      if (match) {
        const [, name, versionStr] = match
        const version = parseInt(versionStr, 10)
        
        if (!isNaN(version)) {
          const filePath = path.join(workingDir, file)
          
          // Check if this file is already a complete schema file (has $schema field)
          // If it is, skip it since it's already been processed
          try {
            const content = await BaseFileManager.readFileAsString(filePath)
            const data = JSON.parse(content) as any
            
            // Skip files that already have $schema (complete schema format)
            // These are already processed and don't need to be imported again
            if (data.$schema) {
              continue
            }
          } catch {
            // If we can't read/parse the file, skip it
            continue
          }
          
          schemas.push({
            name,
            version,
            filePath,
          })
        }
      }
    }

    return schemas
  } catch (error) {
    throw new Error(`Failed to list schemas: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * List all complete schema files in the working directory
 * Only returns files that are complete schema files (i.e., files with $schema field)
 * These are already-processed schema files that need to be loaded into the model store
 * @returns Array of objects containing name, version, and file path for each complete schema
 */
type CompleteSchemaFileInfo = { name: string; version: number; filePath: string; schemaFileId?: string }

export async function listCompleteSchemaFiles(): Promise<CompleteSchemaFileInfo[]> {
  const fs = await BaseFileManager.getFs()
  const path = BaseFileManager.getPathModule()

  // Check if working directory exists
  const workingDir = BaseFileManager.getWorkingDir()

  try {
    // Check if directory exists before trying to read it
    const dirExists = await BaseFileManager.pathExists(workingDir)
    if (!dirExists) {
      // Directory doesn't exist yet - return empty array (not an error condition)
      logger(`Working directory does not exist yet: ${workingDir}, returning empty schema list`)
      return []
    }
    
    const files = await fs.promises.readdir(workingDir)
    const schemas: Array<{ name: string; version: number; filePath: string; schemaFileId?: string }> = []

    for (const file of files) {
      // Match filename pattern: {schemaFileId}_{schemaName}_v{version}.json
      // Ids have no underscores but names can ("My_Schema"), so the id group stops at the first one
      const match = file.match(/^(.+?)_(.+)_v(\d+)\.json$/)
      
      if (match) {
        const [, schemaFileId, , versionStr] = match
        const version = parseInt(versionStr, 10)
        
        if (!isNaN(version)) {
          const filePath = path.join(workingDir, file)
          
          // Check if this file is a complete schema file (has $schema field)
          try {
            const content = await BaseFileManager.readFileAsString(filePath)
            const data = JSON.parse(content) as any
            
            // Only include files that have $schema (complete schema format)
            if (data.$schema && data.metadata?.name) {
              // CRITICAL: Use schemaFileId from filename (source of truth), not from JSON content
              // The filename pattern is {schemaFileId}_{schemaName}_v{version}.json
              // The JSON content's id might be out of sync, but the filename tells us what file actually exists
              schemas.push({
                name: data.metadata.name,
                version: data.version || version,
                filePath,
                schemaFileId: schemaFileId, // Use from filename, not data.id
              })
            }
          } catch {
            // If we can't read/parse the file, skip it
            continue
          }
        }
      }
    }

    return schemas
  } catch (error) {
    throw new Error(`Failed to list complete schemas: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Get the latest version number for a schema by name
 * Only considers complete schema files (with $schema field)
 * @param name - The name of the schema
 * @returns The latest version number, or 0 if no schema found
 */
export async function getLatestSchemaVersion(
  name: string,
): Promise<number> {
  const completeSchemas = await listCompleteSchemaFiles()
  const matchingSchemas = completeSchemas.filter((s) => s.name === name)

  if (matchingSchemas.length === 0) {
    return 0
  }

  // Find the schema with the highest version
  const latest = matchingSchemas.reduce((prev, current) =>
    current.version > prev.version ? current : prev,
  )

  return latest.version
}

/**
 * Get only the latest version of each schema
 * @returns Array of objects containing name, version, and file path for the latest version of each schema
 */
export async function listLatestSchemaFiles(): Promise<Array<{ name: string; version: number; filePath: string }>> {
  const completeSchemas = await listCompleteSchemaFiles()
  
  // Group by schema name and keep only the latest version of each
  const schemaMap = new Map<string, { name: string; version: number; filePath: string }>()
  
  for (const schema of completeSchemas) {
    const existing = schemaMap.get(schema.name)
    if (!existing || schema.version > existing.version) {
      schemaMap.set(schema.name, schema)
    }
  }
  
  return Array.from(schemaMap.values())
}

/**
 * Unified schema loading function that queries database first, then merges with files
 * Returns all schemas with their draft status and source information
 * @returns Array of schema objects with metadata about their state
 */
export type LoadedSchema = {
  schema: SchemaFileFormat
  isDraft: boolean
  source: 'db' | 'file' | 'db+file'
  schemaRecordId?: number
  /** The schema file the entry was read from (source 'file' or 'db+file'). */
  filePath?: string
  /**
   * Source 'db+file' only: the DB row already matched the file before this call (same schema file
   * id and version, file not updated since). The file's models were applied by an earlier load.
   */
  dbMatchesFile?: boolean
}

export async function loadAllSchemasFromDb(): Promise<LoadedSchema[]> {
  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not found')
  }

  const result: LoadedSchema[] = []

  // STEP 1: Query all schemas from database
  const dbSchemas = await db
    .select()
    .from(schemasTable)
    .orderBy(schemasTable.name, desc(schemasTable.version))

  const processedSchemaNames = new Set<string>()

  // List the schema files once. listCompleteSchemaFiles reads and parses every file in the working
  // dir, so listing per schema made this O(files x schemas).
  let completeSchemaFiles: CompleteSchemaFileInfo[] | undefined
  const getCompleteSchemaFiles = async (): Promise<CompleteSchemaFileInfo[]> => {
    if (!completeSchemaFiles) {
      try {
        completeSchemaFiles = await listCompleteSchemaFiles()
      } catch (error) {
        // If we can't list schema files (e.g., directory doesn't exist yet), continue without file-based loading
        logger(`Error listing complete schema files (continuing with DB data): ${error instanceof Error ? error.message : String(error)}`)
        completeSchemaFiles = []
      }
    }
    return completeSchemaFiles
  }

  // STEP 2: Process each database schema
  for (const dbSchema of dbSchemas) {
    const schemaName = dbSchema.name

    // Skip if we've already processed a newer version of this schema
    if (processedSchemaNames.has(schemaName)) {
      continue
    }

    // If it's a draft, load from schemaData
    if (dbSchema.isDraft === true && dbSchema.schemaData) {
      try {
        let schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
        
          // Merge models from DB only when schemaData is incomplete. When schemaData has models (e.g. init),
          // skip the expensive loadModelsFromDbForSchema - it can return 1000s of orphaned model_schemas rows
          // and cause init to hang. The merge is for drafts where schemaData may be missing models.
          const schemaModelCount = Object.keys(schemaFile.models || {}).length
          let mergedModels = { ...(schemaFile.models || {}) }
          if (dbSchema.id && schemaModelCount === 0) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              mergedModels = { ...mergedModels, ...dbModels }
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  mergedModels[modelName] = {
                    ...mergedModels[modelName],
                    properties: {
                      ...mergedModels[modelName].properties,
                      ...dbModel.properties,
                    },
                  }
                }
              }
            }
          }
          
          schemaFile = {
            ...schemaFile,
            models: mergedModels,
          }
        
        result.push({
          schema: schemaFile,
          isDraft: true,
          source: 'db',
          schemaRecordId: dbSchema.id || undefined,
        })
        processedSchemaNames.add(schemaName)
        continue
      } catch (error) {
        logger(`Error parsing schemaData for ${schemaName}:`, error)
        // Fall through to file-based loading
      }
    }

    // If it's not a draft and has schemaFileId, try to load from file
    if (dbSchema.isDraft === false && dbSchema.schemaFileId) {
      const completeSchemas = await getCompleteSchemaFiles()
      const matchingSchemas = completeSchemas.filter((s) => s.name === schemaName)
      
      if (matchingSchemas.length > 0) {
        // Find the schema with the highest version
        const latest = matchingSchemas.reduce((prev, current) =>
          current.version > prev.version ? current : prev,
        )

        try {
          // Read the file directly to get SchemaFileFormat
          const content = await BaseFileManager.readFileAsString(latest.filePath)
          const schemaFile = JSON.parse(content) as SchemaFileFormat

          // Check if file is newer than DB record
          const fileUpdatedAt = new Date(schemaFile.metadata.updatedAt).getTime()
          const dbUpdatedAt = dbSchema.updatedAt || 0

          const dbMatchesFile =
            schemaFile.id === dbSchema.schemaFileId &&
            schemaFile.version === dbSchema.version &&
            fileUpdatedAt <= dbUpdatedAt

          // If file is newer, update DB with file content
          if (fileUpdatedAt > dbUpdatedAt && schemaFile.id === dbSchema.schemaFileId) {
            await addSchemaToDb(
              {
                name: schemaName,
                version: schemaFile.version,
                createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
                updatedAt: fileUpdatedAt,
              },
              schemaFile.id,
              JSON.stringify(schemaFile, null, 2),
              false, // isDraft = false
            )
          }

          result.push({
            schema: schemaFile,
            isDraft: false,
            source: 'db+file',
            schemaRecordId: dbSchema.id || undefined,
            filePath: latest.filePath,
            dbMatchesFile,
          })
          processedSchemaNames.add(schemaName)
          continue
        } catch (error) {
          logger(`Error loading schema file for ${schemaName}:`, error)
          // Fall through to try loading from schemaData if available
        }
      }

      // If file doesn't exist but we have schemaData, use that
      if (dbSchema.schemaData) {
        try {
          let schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
          
          // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
          // This ensures models added to the database are included even if they're not in schemaData
          // Build merged models without mutating schemaFile (read-only approach)
          const schemaModelCount = Object.keys(schemaFile.models || {}).length
          let mergedModels = { ...(schemaFile.models || {}) }
          if (dbSchema.id && schemaModelCount === 0) {
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              mergedModels = { ...mergedModels, ...dbModels }
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  mergedModels[modelName] = {
                    ...mergedModels[modelName],
                    properties: {
                      ...mergedModels[modelName].properties,
                      ...dbModel.properties,
                    },
                  }
                }
              }
            }
          }
          
          schemaFile = {
            ...schemaFile,
            models: mergedModels,
          }
          
        result.push({
          schema: schemaFile,
          isDraft: false,
          source: 'db',
          schemaRecordId: dbSchema.id || undefined,
        })
        processedSchemaNames.add(schemaName)
        continue
        } catch (error) {
          logger(`Error parsing schemaData for ${schemaName}:`, error)
        }
      }
    }
  }

  // STEP 3: Find schema files not yet in database (for migration/backward compatibility)
  const completeSchemas = await getCompleteSchemaFiles()

  for (const schemaFileInfo of completeSchemas) {
    // Only process if not already in result
    if (!processedSchemaNames.has(schemaFileInfo.name)) {
      if (isInternalSchema(schemaFileInfo.name, schemaFileInfo.schemaFileId)) {
        logger(`STEP 3: skipping internal schema file: ${schemaFileInfo.filePath}`)
        continue
      }
      try {
        logger(`STEP 3: processing schema file: ${schemaFileInfo.name} from ${schemaFileInfo.filePath}`)
        const content = await BaseFileManager.readFileAsString(schemaFileInfo.filePath)
        const schemaFile = JSON.parse(content) as SchemaFileFormat

        // Import this schema to database (mark as non-draft since it's in a file)
        const schemaRecord = await addSchemaToDb(
          {
            name: schemaFile.metadata.name,
            version: schemaFile.version,
            createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
            updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
          },
          schemaFile.id,
          JSON.stringify(schemaFile, null, 2),
          false, // isDraft = false (it's in a file, so it's published)
        )

        result.push({
          schema: schemaFile,
          isDraft: false,
          source: 'file',
          schemaRecordId: schemaRecord.id || undefined,
          filePath: schemaFileInfo.filePath,
        })
        processedSchemaNames.add(schemaFileInfo.name)
      } catch (error) {
        logger(`Error loading schema file ${schemaFileInfo.filePath}:`, error)
      }
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


import { BaseFileManager } from './FileManager/BaseFileManager'
import { Model } from '@/Model/Model'
import { SchemaFileFormat } from '@/types/import'
import debug from 'debug'

const logger = debug('seedSdk:helpers:schema')
/**
 * 
 * Schema type definition
 * A Schema is a collection of Models with a name and version
 */
export type Schema = {
  id?: string
  name?: string
  metadata?: {
    name: string
    createdAt: string
    updatedAt: string
  }
  version: number
  models: Model[]
}


/**
 * Sanitize a schema name to be filesystem-safe
 * Replaces all special characters (except alphanumeric, hyphens, underscores) with underscores
 * Converts spaces to underscores
 * Removes leading/trailing underscores
 * 
 * @param name - Schema name to sanitize
 * @returns Sanitized name safe for use in filenames
 */
const sanitizeSchemaName = (name: string): string => {
  return name
    .replace(/[^a-zA-Z0-9\s_-]/g, '_') // Replace special chars (except spaces, hyphens, underscores) with underscore
    .replace(/\s+/g, '_') // Convert spaces to underscores
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .replace(/_+/g, '_') // Collapse multiple underscores to single
}

/**
 * Generate filename for a schema
 * Format: {schemaFileId}_{schemaName}_v{version}.json
 * 
 * The ID-first format ensures all files for a schema group together when sorted alphabetically.
 * 
 * @param name - Schema name
 * @param version - Schema version
 * @param schemaFileId - Schema file ID (required)
 */
const getSchemaFilename = (name: string, version: number, schemaFileId: string): string => {
  const sanitizedName = sanitizeSchemaName(name)
  return `${schemaFileId}_${sanitizedName}_v${version}.json`
}

/**
 * Get the full file path for a schema
 * Format: {schemaFileId}_{schemaName}_v{version}.json
 * 
 * The ID-first format ensures all files for a schema group together when sorted alphabetically.
 * 
 * @param name - Schema name
 * @param version - Schema version
 * @param schemaFileId - Schema file ID (required)
 */
const getSchemaFilePath = (name: string, version: number, schemaFileId: string): string => {
  const path = BaseFileManager.getPathModule()
  const filename = getSchemaFilename(name, version, schemaFileId)
  const workingDir = BaseFileManager.getWorkingDir()
  return path.join(workingDir, filename)
}

/**
 * Create a new schema file
 * @param schema - The schema object to save
 * @param schemaFileId - Schema file ID (required)
 * @throws Error if schema already exists or if workingDir is invalid
 */
export const createSchema = async (schema: Schema, schemaFileId: string): Promise<void> => {
  if (!schema.name || !schema.version) {
    throw new Error('Schema must have a name and version')
  }

  const filePath = getSchemaFilePath(schema.name, schema.version, schemaFileId)

  // Check if schema already exists
  const exists = await BaseFileManager.pathExists(filePath)
  if (exists) {
    throw new Error(`Schema ${schema.name} v${schema.version} already exists`)
  }

  // Ensure working directory exists
  const workingDir = BaseFileManager.getWorkingDir()
  await BaseFileManager.createDirIfNotExists(workingDir)

  // Write schema to file
  const content = JSON.stringify(schema, null, 2)
  await BaseFileManager.saveFile(filePath, content)
}

/**
 * Read a schema file by name and version
 * @param name - The name of the schema
 * @param version - The version of the schema
 * @param schemaFileId - Schema file ID (required)
 * @returns The schema object, or null if not found
 */
export const readSchema = async (
  name: string,
  version: number,
  schemaFileId: string,
): Promise<Schema | null> => {
  const filePath = getSchemaFilePath(name, version, schemaFileId)

  const exists = await BaseFileManager.pathExists(filePath)
  if (!exists) {
    return null
  }

  try {
    const content = await BaseFileManager.readFileAsString(filePath)
    return JSON.parse(content) as Schema
  } catch (error) {
    throw new Error(`Failed to read schema ${name} v${version}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Update an existing schema file
 * @param schema - The updated schema object (must have same name and version as existing)
 * @param schemaFileId - Schema file ID (required)
 * @throws Error if schema doesn't exist
 */
export async function updateSchema(schema: Schema, schemaFileId: string): Promise<void> {
  if (!schema.name || !schema.version) {
    throw new Error('Schema must have a name and version')
  }

  const filePath = getSchemaFilePath(schema.name, schema.version, schemaFileId)

  // Check if schema exists
  const exists = await BaseFileManager.pathExists(filePath)
  if (!exists) {
    throw new Error(`Schema ${schema.name} v${schema.version} does not exist`)
  }

  // Write updated schema to file
  const content = JSON.stringify(schema, null, 2)
  await BaseFileManager.saveFile(filePath, content)
}

/**
 * Delete a schema file
 * @param name - The name of the schema
 * @param version - The version of the schema
 * @param schemaFileId - Schema file ID (required)
 * @throws Error if schema doesn't exist
 */
export async function deleteSchema(
  name: string,
  version: number,
  schemaFileId: string,
): Promise<void> {
  const filePath = getSchemaFilePath(name, version, schemaFileId)

  // Check if schema exists
  const exists = await BaseFileManager.pathExists(filePath)
  if (!exists) {
    throw new Error(`Schema ${name} v${version} does not exist`)
  }

  // Delete the file
  const fs = await BaseFileManager.getFs()
  const path = BaseFileManager.getPathModule()
  
  try {
    await fs.promises.unlink(filePath)
  } catch (error) {
    throw new Error(`Failed to delete schema ${name} v${version}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

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
          } catch (error) {
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
export async function listCompleteSchemaFiles(): Promise<Array<{ name: string; version: number; filePath: string; schemaFileId?: string }>> {
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
      const match = file.match(/^(.+)_(.+)_v(\d+)\.json$/)
      
      if (match) {
        const [, schemaFileId, schemaName, versionStr] = match
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
          } catch (error) {
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
 * Find a schema by name (returns the latest version if multiple versions exist)
 * @param name - The name of the schema
 * @returns The schema with the highest version, or null if not found
 */
export async function findSchemaByName(
  name: string,
): Promise<Schema | null> {
  const schemas = await listCompleteSchemaFiles()
  const matchingSchemas = schemas.filter((s) => s.name === name)

  if (matchingSchemas.length === 0) {
    return null
  }

  // Find the schema with the highest version
  const latest = matchingSchemas.reduce((prev, current) =>
    current.version > prev.version ? current : prev,
  )

  if (!latest.schemaFileId) {
    throw new Error(`Schema ${latest.name} v${latest.version} is missing schemaFileId`)
  }

  return readSchema(latest.name, latest.version, latest.schemaFileId)
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
 * Filter an array of schemas to only include the latest version for each schema name
 * Works with any object that has a name (via metadata.name or name property) and a version property
 * @param schemas - Array of schema objects
 * @returns Array containing only the latest version of each schema
 */
export function filterLatestSchemas<T extends { name?: string; metadata?: { name: string }; version: number }>(schemas: T[]): T[] {
  // Group by schema name and keep only the latest version of each
  const schemaMap = new Map<string, T>()
  
  for (const schema of schemas) {
    const schemaName = schema.metadata?.name || schema.name
    if (!schemaName) {
      continue // Skip schemas without a name
    }
    
    const existing = schemaMap.get(schemaName)
    if (!existing || schema.version > existing.version) {
      schemaMap.set(schemaName, schema)
    }
  }
  
  return Array.from(schemaMap.values())
}

/**
 * Unified schema loading function that queries database first, then merges with files
 * Returns all schemas with their draft status and source information
 * @returns Array of schema objects with metadata about their state
 */
export async function loadAllSchemasFromDb(): Promise<Array<{
  schema: SchemaFileFormat
  isDraft: boolean
  source: 'db' | 'file' | 'db+file'
  schemaRecordId?: number
}>> {
  const { BaseDb } = await import('@/db/Db/BaseDb')
  const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
  const { desc } = await import('drizzle-orm')

  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not found')
  }

  const result: Array<{
    schema: SchemaFileFormat
    isDraft: boolean
    source: 'db' | 'file' | 'db+file'
    schemaRecordId?: number
  }> = []

  // STEP 1: Query all schemas from database
  // Also do a direct SQL query to verify what's actually in the database
  const { sql } = await import('drizzle-orm')
  const directQuery = await db.run(sql.raw(`SELECT name, version, schema_file_id, id FROM schemas ORDER BY name, version DESC`))
  console.log(`[loadAllSchemasFromDb] Direct SQL query result:`, directQuery.rows?.map((row: any) => ({ name: row[0], version: row[1], schemaFileId: row[2], id: row[3] })) || [])
  
  const dbSchemas = await db
    .select()
    .from(schemasTable)
    .orderBy(schemasTable.name, desc(schemasTable.version))

  console.log(`[loadAllSchemasFromDb] Drizzle query returned ${dbSchemas.length} schemas:`, dbSchemas.map(s => ({ name: s.name, version: s.version, schemaFileId: s.schemaFileId, isDraft: s.isDraft, id: s.id })))
  console.log(`[loadAllSchemasFromDb] Schema names in query result:`, dbSchemas.map(s => s.name))

  const processedSchemaNames = new Set<string>()

  // STEP 2: Process each database schema
  for (const dbSchema of dbSchemas) {
    const schemaName = dbSchema.name

    console.log(`[loadAllSchemasFromDb] Processing schema: ${schemaName} (id: ${dbSchema.id}, isDraft: ${dbSchema.isDraft}, hasSchemaData: ${!!dbSchema.schemaData}, schemaFileId: ${dbSchema.schemaFileId})`)

    // Skip if we've already processed a newer version of this schema
    if (processedSchemaNames.has(schemaName)) {
      console.log(`[loadAllSchemasFromDb] Skipping ${schemaName} - already processed`)
      continue
    }

    // If it's a draft, load from schemaData
    if (dbSchema.isDraft === true && dbSchema.schemaData) {
      try {
        let schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
        
          // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
          // This ensures models added to the database are included even if they're not in schemaData
          // Build merged models without mutating schemaFile (read-only approach)
          let mergedModels = { ...(schemaFile.models || {}) }
          if (dbSchema.id) {
            const { loadModelsFromDbForSchema } = await import('@/helpers/db')
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              // Merge: database models take precedence for properties, but preserve schemaData models for full structure
              mergedModels = {
                ...mergedModels,
                ...dbModels,
              }
              // For models that exist in both, merge properties (database properties override)
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  // Merge properties, with database properties taking precedence
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
          
          // Create new schemaFile object with merged models (read-only approach)
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
      let completeSchemas: Array<{ name: string; version: number; filePath: string; schemaFileId?: string }> = []
      try {
        completeSchemas = await listCompleteSchemaFiles()
      } catch (error) {
        // If we can't list schema files (e.g., directory doesn't exist yet), continue without file-based loading
        logger(`Error listing complete schema files (continuing with DB data): ${error instanceof Error ? error.message : String(error)}`)
      }
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

          // If file is newer, update DB with file content
          if (fileUpdatedAt > dbUpdatedAt && schemaFile.id === dbSchema.schemaFileId) {
            const { addSchemaToDb } = await import('@/helpers/db')
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
          })
          processedSchemaNames.add(schemaName)
          continue
        } catch (error) {
          logger(`Error loading schema file for ${schemaName}:`, error)
          // Fall through to try loading from schemaData if available
        }
      }

      // If file doesn't exist but we have schemaData, use that
      console.log(`[loadAllSchemasFromDb] ${schemaName}: file not found, checking schemaData...`)
      if (dbSchema.schemaData) {
        try {
          let schemaFile = JSON.parse(dbSchema.schemaData) as SchemaFileFormat
          
          // CRITICAL: Merge models from database (model_schemas join table) with models from schemaData
          // This ensures models added to the database are included even if they're not in schemaData
          // Build merged models without mutating schemaFile (read-only approach)
          let mergedModels = { ...(schemaFile.models || {}) }
          if (dbSchema.id) {
            const { loadModelsFromDbForSchema } = await import('@/helpers/db')
            const dbModels = await loadModelsFromDbForSchema(dbSchema.id)
            if (Object.keys(dbModels).length > 0) {
              // Merge: database models take precedence for properties, but preserve schemaData models for full structure
              mergedModels = {
                ...mergedModels,
                ...dbModels,
              }
              // For models that exist in both, merge properties (database properties override)
              for (const [modelName, dbModel] of Object.entries(dbModels)) {
                if (mergedModels[modelName]) {
                  // Merge properties, with database properties taking precedence
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
          
          // Create new schemaFile object with merged models (read-only approach)
          schemaFile = {
            ...schemaFile,
            models: mergedModels,
          }
          
        console.log(`[loadAllSchemasFromDb] Adding schema from schemaData: ${schemaName} (id: ${dbSchema.id}, schemaFileId: ${dbSchema.schemaFileId})`)
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
      } else {
        console.log(`[loadAllSchemasFromDb] ${schemaName}: No file and no schemaData - SKIPPING`)
      }
    }
  }

  // STEP 3: Find schema files not yet in database (for migration/backward compatibility)
  const completeSchemas = await listCompleteSchemaFiles()

  for (const schemaFileInfo of completeSchemas) {
    // Only process if not already in result
    if (!processedSchemaNames.has(schemaFileInfo.name)) {
      try {
        const content = await BaseFileManager.readFileAsString(schemaFileInfo.filePath)
        const schemaFile = JSON.parse(content) as SchemaFileFormat

        // Import this schema to database (mark as non-draft since it's in a file)
        const { addSchemaToDb } = await import('@/helpers/db')
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
 * Migration helper: Migrate existing file-based schemas to the database
 * This function should be called once to migrate existing schema files to the new database-first approach
 * All existing schemas will be marked as published (isDraft = false) since they already exist in files
 * @returns Number of schemas migrated
 */
export async function migrateFileSchemasToDb(): Promise<number> {
  const { BaseDb } = await import('@/db/Db/BaseDb')
  const { schemas: schemasTable } = await import('@/seedSchema/SchemaSchema')
  const { eq } = await import('drizzle-orm')
  const { addSchemaToDb } = await import('@/helpers/db')

  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not found')
  }

  logger('Starting migration of file-based schemas to database')

  // Get all complete schema files
  const completeSchemas = await listCompleteSchemaFiles()
  let migratedCount = 0

  for (const schemaFileInfo of completeSchemas) {
    try {
      // Read the schema file
      const content = await BaseFileManager.readFileAsString(schemaFileInfo.filePath)
      const schemaFile = JSON.parse(content) as SchemaFileFormat

      if (!schemaFile.$schema || !schemaFile.metadata?.name) {
        logger(`Skipping invalid schema file: ${schemaFileInfo.filePath}`)
        continue
      }

      const schemaName = schemaFile.metadata.name

      // Check if schema already exists in database
      const existingSchemas = await db
        .select()
        .from(schemasTable)
        .where(eq(schemasTable.name, schemaName))
        .limit(1)

      // Only migrate if it doesn't exist or if existing record doesn't have schemaFileId
      if (existingSchemas.length === 0 || !existingSchemas[0].schemaFileId) {
        // Add schema to database as published (isDraft = false)
        await addSchemaToDb(
          {
            name: schemaName,
            version: schemaFile.version,
            createdAt: new Date(schemaFile.metadata.createdAt).getTime(),
            updatedAt: new Date(schemaFile.metadata.updatedAt).getTime(),
          },
          schemaFile.id, // schemaFileId
          JSON.stringify(schemaFile, null, 2), // schemaData
          false, // isDraft = false (it's in a file, so it's published)
        )

        migratedCount++
        logger(`Migrated schema: ${schemaName} v${schemaFile.version}`)
      } else {
        logger(`Schema ${schemaName} already exists in database, skipping`)
      }
    } catch (error) {
      logger(`Error migrating schema file ${schemaFileInfo.filePath}:`, error)
    }
  }

  logger(`Migration complete: ${migratedCount} schemas migrated`)
  return migratedCount
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
  const lastDashIndex = schemaId.lastIndexOf('-')
  if (lastDashIndex === -1 || lastDashIndex === 0 || lastDashIndex === schemaId.length - 1) {
    return null
  }
  return schemaId.substring(0, lastDashIndex)
}


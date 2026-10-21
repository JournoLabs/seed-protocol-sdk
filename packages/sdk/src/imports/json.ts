import { BaseFileManager } from '../helpers/FileManager/BaseFileManager'
import { isNode } from '../helpers/environment'
import { JsonImportSchema, SchemaFileFormat, SchemaFileInput } from '../types/import'
import { normalizeSchemaModels, readSchemaFile } from '@/helpers/schema'
import { applySchemaFile, deriveSchemaFileId, toSchemaFile } from '@/helpers/schemaApply'

/**
 * Transform import JSON format to full schema file format. Missing ids are derived from the
 * schema, model and property names, as an import assigns them.
 * @param importData - The JSON import data
 * @param version - The version number for the schema (defaults to 1)
 * @returns The transformed schema file format
 */
export const transformImportToSchemaFile = (
  importData: JsonImportSchema,
  version: number = 1,
): SchemaFileFormat => {
  const file = toSchemaFile({ ...importData, version })
  const schemaName = file.metadata.name
  file.id ??= deriveSchemaFileId(schemaName)
  for (const [modelName, model] of Object.entries(file.models)) {
    model.id ??= deriveSchemaFileId(schemaName, modelName)
    for (const [propName, prop] of Object.entries(model.properties ?? {})) {
      prop.id ??= deriveSchemaFileId(schemaName, modelName, propName)
    }
  }
  return file
}

/**
 * Parse JSON import content (string) into JsonImportSchema format
 * Supports two formats:
 * 1. Minimal format: { name: string, models: {...} }
 * 2. Complete schema format: { $schema: string, metadata: { name: string }, models: {...}, ... }
 * @param content - The JSON content as a string
 * @returns The parsed JSON import data normalized to JsonImportSchema format
 * @throws Error if content cannot be parsed
 */
export const parseJsonImportContent = (
  content: string,
): JsonImportSchema => {
  try {
    const data = JSON.parse(content) as any

    // Complete schema format keeps the name in metadata.name, minimal format at the top level.
    // A schema file without $schema (SchemaFileInput) still has metadata.name.
    const schemaName: string | undefined = data.$schema
      ? data.metadata?.name
      : (data.name ?? data.metadata?.name)

    if (!schemaName) {
      throw new Error('Schema name is required (either at top level or in metadata.name)')
    }

    const models = normalizeSchemaModels(data.models) as JsonImportSchema['models']
    return {
      name: schemaName,
      ...(data.nameMatch !== undefined && { nameMatch: data.nameMatch }),
      models,
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON content: ${error.message}`)
    }
    throw new Error(
      `Failed to parse JSON import content: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const resolveImportPath = (filePath: string): string => {
  const workingDir = BaseFileManager.getWorkingDir()
  return filePath.startsWith(workingDir) ? filePath : `${workingDir}/${filePath}`
}

/**
 * Read and parse a JSON import file
 * Supports two formats:
 * 1. Minimal format: { name: string, models: {...} }
 * 2. Complete schema format: { $schema: string, metadata: { name: string }, models: {...}, ... }
 * @param filePath - Path to the JSON import file
 * @returns The parsed JSON import data normalized to JsonImportSchema format
 * @throws Error if file cannot be read or parsed
 */
export const readJsonImportFile = async (
  filePath: string,
): Promise<JsonImportSchema> => {
  try {
    return parseJsonImportContent(await BaseFileManager.readFileAsString(resolveImportPath(filePath)))
  } catch (error) {
    throw new Error(
      `Failed to read JSON import file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** A schema's JSON (either format) as a schema file; `version` applies when the JSON has none. */
const parseSchemaJson = (content: string, version?: number): { file: SchemaFileFormat; complete: boolean } => {
  let data: any
  try {
    data = JSON.parse(content)
  } catch (error) {
    throw new Error(`Invalid JSON content: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (data && data.version === undefined && version !== undefined) data.version = version
  return { file: toSchemaFile(data), complete: !!data?.$schema }
}

export async function importJsonSchema(
  importFilePath: string,
  version?: number,
): Promise<string>
/**
 * Import a JSON schema from file contents and save it in the full schema file format
 * Also converts the JSON models to Model classes and adds them to the database
 * @param importFileContents - Object containing the JSON file contents as a string
 * @param version - The version for a schema whose JSON has none (defaults to 1)
 * @returns The file path where the schema was saved ('' for the internal schema)
 * @throws Error if the content can't be parsed, or a stored file has this id and version with
 *   other content
 */
export async function importJsonSchema(
  importFileContents: { contents: string },
  version?: number,
): Promise<string>
export async function importJsonSchema(
  importFilePathOrContents: string | { contents: string },
  version?: number,
): Promise<string> {
  const content =
    typeof importFilePathOrContents === 'string'
      ? await BaseFileManager.readFileAsString(resolveImportPath(importFilePathOrContents))
      : importFilePathOrContents.contents
  const { file, complete } = parseSchemaJson(content, version)
  // A changed minimal { name, models } file becomes the next version; a changed complete file
  // with the same version is an error.
  const { filePath } = await applySchemaFile(file, { onChangedContent: complete ? 'throw' : 'bump' })
  return filePath ?? ''
}

/**
 * Sync a canonical schema from a file path or inlined object to the database.
 * A stored schema file with the same id and version but different content is overwritten (with a
 * warning) instead of reused, and models dropped from the schema are unlinked from it.
 * Called automatically at init when config.schema is provided.
 *
 * @param source - File path (string) or complete SchemaFileFormat object
 */
export async function syncSchemaFromSource(
  source: string | SchemaFileInput,
): Promise<void> {
  let file: SchemaFileFormat
  if (typeof source === 'string') {
    const path = BaseFileManager.getPathModule()
    const resolvedPath = path.isAbsolute(source)
      ? source
      : isNode()
        ? path.resolve(process.cwd(), source)
        : path.join(BaseFileManager.getWorkingDir(), source)
    file = parseSchemaJson(await BaseFileManager.readFileAsString(resolvedPath)).file
  } else {
    file = toSchemaFile(source)
  }
  await applySchemaFile(file, { onChangedContent: 'replace' })
}

/**
 * Apply a complete schema file (one with `$schema`) to the database
 * @param schemaFilePath - Path to the complete schema file
 * @returns The file path of the schema
 * @throws Error if file cannot be read, parsed, or is not a complete schema
 */
export const loadSchemaFromFile = async (
  schemaFilePath: string,
): Promise<string> => {
  const schemaFile = await readSchemaFile(schemaFilePath)
  if (!schemaFile) {
    throw new Error(
      `Failed to load schema from file ${schemaFilePath}: not a readable complete schema file (missing $schema field?). Use importJsonSchema() for minimal format files.`,
    )
  }
  if (!schemaFile.metadata?.name) {
    throw new Error(`Failed to load schema from file ${schemaFilePath}: Schema name is required in metadata.name`)
  }
  await applySchemaFile(schemaFile, { onChangedContent: 'replace' })
  return schemaFilePath
}

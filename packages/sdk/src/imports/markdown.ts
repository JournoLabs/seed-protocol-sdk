import yaml from 'js-yaml'
import { readFileSync } from 'fs'
import { Property, ModelPropertyDataTypes } from '@/Schema'
import { ModelDefinitions } from '@/types'
import { addModelsToDb } from '../helpers/db'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import type { Model } from '@/Model/Model'

/**
 * Configuration structure expected in markdown frontmatter
 */
type SeedConfig = {
  seed: {
    model: string
    properties: {
      [propertyName: string]: {
        type: string
        target?: string
        /** For List: element type when primitive (e.g. 'Text', 'Number'). Use target for list of relations. */
        itemsType?: string
      }
    }
  }
}

/**
 * Parses markdown frontmatter from a file
 * @param filePath Path to the markdown file
 * @returns The parsed frontmatter as an object, or null if no frontmatter found
 */
export const parseMarkdownFrontmatter = (
  filePath: string,
): Record<string, any> | null => {
  const content = readFileSync(filePath, 'utf-8')
  
  // Check for frontmatter delimiters (more flexible regex)
  // Matches --- at start, optional whitespace, content, ---, optional whitespace
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---(\s*\n|$)/
  const match = content.match(frontmatterRegex)
  
  if (!match) {
    return null
  }
  
  const frontmatterYaml = match[1]
  
  try {
    const frontmatter = yaml.load(frontmatterYaml) as Record<string, any>
    return frontmatter
  } catch (error) {
    throw new Error(
      `Failed to parse YAML frontmatter in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Converts a seed config from frontmatter to ModelDefinitions format
 * @param config The seed configuration from frontmatter
 * @returns ModelDefinitions object ready to be saved to database
 */
export const processSeedConfig = (config: SeedConfig): ModelDefinitions => {
  if (!config.seed) {
    throw new Error('No seed configuration found in frontmatter')
  }
  
  const { model: modelName, properties: propertiesConfig } = config.seed
  
  if (!modelName) {
    throw new Error('Model name is required in seed configuration')
  }
  
  if (!propertiesConfig || Object.keys(propertiesConfig).length === 0) {
    throw new Error('Properties are required in seed configuration')
  }
  
  // Convert property configs to Property definitions
  const schema: Record<string, any> = {}
  
  for (const [propertyName, propertyConfig] of Object.entries(propertiesConfig)) {
    const { type, target, itemsType } = propertyConfig
    
    if (!type) {
      throw new Error(`Property type is required for ${propertyName}`)
    }
    
    // Map the type to Property constructor
    switch (type) {
      case ModelPropertyDataTypes.Text:
        schema[propertyName] = Property.Text()
        break
      case ModelPropertyDataTypes.Number:
        schema[propertyName] = Property.Number()
        break
      case ModelPropertyDataTypes.Boolean:
        schema[propertyName] = Property.Boolean()
        break
      case ModelPropertyDataTypes.Date:
        schema[propertyName] = Property.Date()
        break
      case ModelPropertyDataTypes.Image:
        schema[propertyName] = Property.Image()
        break
      case ModelPropertyDataTypes.Json:
        schema[propertyName] = Property.Json()
        break
      case ModelPropertyDataTypes.File:
        schema[propertyName] = Property.File()
        break
      case ModelPropertyDataTypes.Relation:
        if (!target) {
          throw new Error(
            `Target model is required for Relation property ${propertyName}`,
          )
        }
        schema[propertyName] = Property.Relation(target)
        break
      case ModelPropertyDataTypes.List:
        if (itemsType) {
          // List of primitives: itemsType = 'Text', 'Number', etc.
          if (itemsType === ModelPropertyDataTypes.Relation && target) {
            schema[propertyName] = Property.List('Relation', target)
          } else if (itemsType !== ModelPropertyDataTypes.Relation) {
            schema[propertyName] = Property.List(itemsType as any)
          } else {
            throw new Error(
              `List of relations requires target model for property ${propertyName}`,
            )
          }
        } else if (target) {
          // Backward compat: target = model name for list of relations
          schema[propertyName] = Property.List('Relation', target)
        } else {
          throw new Error(
            `List property ${propertyName} requires either itemsType (e.g. 'Text') or target (model name for list of relations)`,
          )
        }
        break
      default:
        throw new Error(
          `Unknown property type: ${type} for property ${propertyName}`,
        )
    }
  }
  
  // Create a mock ModelClass structure that matches ModelDefinitions
  // This is a simplified version that works with addModelsToInternalDb
  const modelClass = {
    schema,
    create: async () => {
      throw new Error('Model.create() should not be called directly')
    },
    originalConstructor: class {},
  }
  
  return {
    [modelName]: modelClass as any as Model,
  }
}

/**
 * Reads a markdown file, parses frontmatter, and saves models/properties to database
 * @param filePath Path to the markdown file
 * @param db Database instance (BetterSQLite3Database or SqliteRemoteDatabase)
 * @returns The created ModelDefinitions
 */
export const saveModelsFromMarkdown = async (
  filePath: string,
  db: BetterSQLite3Database<any> | SqliteRemoteDatabase<any>,
): Promise<ModelDefinitions> => {
  // Parse frontmatter
  const frontmatter = parseMarkdownFrontmatter(filePath)
  
  if (!frontmatter) {
    throw new Error(`No frontmatter found in ${filePath}`)
  }
  
  // Validate and process seed config
  const seedConfig = frontmatter as SeedConfig
  const modelDefinitions = processSeedConfig(seedConfig)
  
  // Save to database
  await addModelsToDb(modelDefinitions, undefined, undefined, undefined)
  
  return modelDefinitions
}

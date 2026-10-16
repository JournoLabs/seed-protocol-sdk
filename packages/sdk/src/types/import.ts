import type { NameMatchLevel } from '@seedprotocol/eas'

/**
 * How strictly names from EAS (other publishers' model and property names) match a local model or
 * property (ADR 0009): `'exact'`, `'normalized'` (case and separators) or `'fuzzy'` (also plural `s`
 * and a relation's `id`/`ids`). Set on a property, a model or the schema; the first one set wins.
 * Default `'fuzzy'`.
 */
export type SchemaNameMatch = NameMatchLevel

/**
 * Import JSON schema format (input)
 */
export type JsonImportSchema = {
  name: string
  /** Default {@link SchemaNameMatch} for this schema's models and properties. */
  nameMatch?: SchemaNameMatch
  models: {
    [modelName: string]: {
      description?: string
      /** {@link SchemaNameMatch} for the model's name, and the default for its properties. */
      nameMatch?: SchemaNameMatch
      properties: {
        [propertyName: string]: {
          type: string
          required?: boolean
          /** {@link SchemaNameMatch} for this property's name. */
          nameMatch?: SchemaNameMatch
          description?: string
          storage?: {
            type: string
            path?: string
            extension?: string
          }
          validation?: {
            pattern?: string
            [key: string]: any
          }
          model?: string
          accessor?: string
          refValueType?: string
          ref?: string
          /** @deprecated Use refValueType and ref instead */
          items?: {
            type: string
            model?: string
            [key: string]: any
          }
          [key: string]: any
        }
      }
      indexes?: string[]
    }
  }
}

/**
 * Full schema file format (output)
 */
export type SchemaFileFormat = {
  $schema: string
  version: number
  id?: string // Schema ID generated when first written to JSON file
  /** Default {@link SchemaNameMatch} for this schema's models and properties. */
  nameMatch?: SchemaNameMatch
  metadata: {
    name: string
    createdAt: string
    updatedAt: string
  }
  models: {
    [modelName: string]: {
      id?: string // Model ID generated when first written to JSON file
      description?: string
      /** {@link SchemaNameMatch} for the model's name, and the default for its properties. */
      nameMatch?: SchemaNameMatch
      properties: {
        [propertyName: string]: {
          id?: string // Property ID generated when first written to JSON file
          /** {@link SchemaNameMatch} for this property's name. */
          nameMatch?: SchemaNameMatch
          [key: string]: any
        }
      }
      indexes?: string[]
    }
  }
  enums: {
    [enumName: string]: any
  }
  /**
   * A record of the schema's changes, stored and returned as written. The SDK doesn't run them:
   * local data isn't transformed when a schema's version changes (ADR 0008).
   */
  migrations: Array<{
    version: number
    timestamp: string
    description: string
    changes: any[]
  }>
}
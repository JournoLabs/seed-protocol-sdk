/**
 * Import JSON schema format (input)
 */
export type JsonImportSchema = {
  name: string
  models: {
    [modelName: string]: {
      description?: string
      properties: {
        [propertyName: string]: {
          type: string
          required?: boolean
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
  metadata: {
    name: string
    createdAt: string
    updatedAt: string
  }
  models: {
    [modelName: string]: {
      id?: string // Model ID generated when first written to JSON file
      description?: string
      properties: {
        [propertyName: string]: {
          id?: string // Property ID generated when first written to JSON file
          [key: string]: any
        }
      }
      indexes?: string[]
    }
  }
  enums: {
    [enumName: string]: any
  }
  migrations: Array<{
    version: number
    timestamp: string
    description: string
    changes: any[]
  }>
}
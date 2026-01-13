import { InferSelectModel, } from 'drizzle-orm'
import { int, sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core'


export const schemas = sqliteTable(
  'schemas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    schemaFileId: text('schema_file_id'), // ID from JSON file for change tracking - must be unique
    schemaData: text('schema_data'), // Full JSON schema content (SchemaFileFormat as JSON string)
    isDraft: integer('is_draft', { mode: 'boolean' }), // true if schema is in draft/editing state, false if published to file
    createdAt: int('created_at'),
    updatedAt: int('updated_at'),
  },
  (table) => {
    return {
      uniqueSchemaFileId: unique('unique_schema_schema_file_id').on(table.schemaFileId),
    }
  }
)

export type SchemaType = InferSelectModel<typeof schemas>
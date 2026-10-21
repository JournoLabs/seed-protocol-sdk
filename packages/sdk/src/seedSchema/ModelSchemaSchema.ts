import { integer, sqliteTable, unique } from 'drizzle-orm/sqlite-core';
import { InferSelectModel } from 'drizzle-orm';
import { schemas } from './SchemaSchema';
import { models } from './ModelSchema';

export const modelSchemas = sqliteTable('model_schemas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  modelId: integer('model_id').references(() => models.id),
  schemaId: integer('schema_id').references(() => schemas.id),
}, (table) => [
  // One link per model and schema (migration 0029)
  unique('model_schemas_model_id_schema_id_unique').on(table.modelId, table.schemaId),
])

export type ModelSchemaType = InferSelectModel<typeof modelSchemas>
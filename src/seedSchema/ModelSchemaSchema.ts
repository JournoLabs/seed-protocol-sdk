import { integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { InferSelectModel } from "drizzle-orm";
import { schemas } from "./SchemaSchema";
import { models } from "./ModelSchema";

export const modelSchemas = sqliteTable('model_schemas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  modelId: integer('model_id').references(() => models.id),
  schemaId: integer('schema_id').references(() => schemas.id),
})

export type ModelSchemaType = InferSelectModel<typeof modelSchemas>
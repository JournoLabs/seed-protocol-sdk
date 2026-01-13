import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { InferInsertModel, InferSelectModel } from 'drizzle-orm'


export const models = sqliteTable(
  'models',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    schemaFileId: text('schema_file_id'), // ID from JSON file for change tracking - must be unique
  },
  (table) => {
    return {
      uniqueSchemaFileId: unique('unique_schema_file_id').on(table.schemaFileId),
    }
  }
)

export const modelsRelations = relations(models, ({ many }) => ({
  properties: many(properties),
}))

export type NewModelRecord = typeof models.$inferInsert
export type ModelRecordType = typeof models.$inferSelect

export const properties = sqliteTable(
  'properties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    dataType: text('data_type').notNull(),
    modelId: integer('model_id')
      .notNull()
      .references(() => models.id),
    refModelId: integer('ref_model_id').references(() => models.id),
    refValueType: text('ref_value_type'),
    schemaFileId: text('schema_file_id'), // ID from JSON file for change tracking
  },
  (table) => {
    return {
      uniqueNameModelId: unique('unique_name_model_id').on(
        table.name,
        table.modelId,
      ),
      uniqueSchemaFileId: unique('unique_property_schema_file_id').on(table.schemaFileId),
    }
  },
)

export const propertiesRelations = relations(properties, ({ one }) => ({
  model: one(models),
  refModel: one(models),
}))

export type NewPropertyRecord = InferInsertModel<typeof properties>
export type PropertyType = InferSelectModel<typeof properties>

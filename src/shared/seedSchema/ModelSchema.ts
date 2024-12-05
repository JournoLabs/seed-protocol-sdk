import { int, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

export const models = sqliteTable('models', {
  id: int('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

export const modelsRelations = relations(models, ({ many }) => ({
  properties: many(properties),
}))

export type NewModelRecord = typeof models.$inferInsert
export type ModelRecordType = typeof models.$inferSelect

export const properties = sqliteTable(
  'properties',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    dataType: text('data_type').notNull(),
    readEndpoint: text('read_endpoint'),
    updateEndpoint: text('update_endpoint'),
    modelId: int('model_id')
      .notNull()
      .references(() => models.id),
    refModelId: int('ref_model_id').references(() => models.id),
    refValueType: text('ref_value_type'),
  },
  (table) => {
    return {
      uniqueNameModelId: unique('unique_name_model_id').on(
        table.name,
        table.modelId,
      ),
    }
  },
)

export const propertiesRelations = relations(properties, ({ one }) => ({
  model: one(models),
  refModel: one(models),
}))

export type NewPropertyRecord = typeof properties.$inferInsert
export type PropertyType = typeof properties.$inferSelect

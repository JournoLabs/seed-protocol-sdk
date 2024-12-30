import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { models } from './ModelSchema'

export const modelUids = sqliteTable('model_uids', {
  id: int('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull(),
  modelId: int('model_id')
    .notNull()
    .unique()
    .references(() => models.id),
})

export const modelRelations = relations(modelUids, ({ many, one }) => ({
  model: one(models),
}))

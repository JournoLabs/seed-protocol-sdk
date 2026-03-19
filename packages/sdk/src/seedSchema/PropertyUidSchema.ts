import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'
import { properties } from './ModelSchema'

export const propertyUids = sqliteTable('property_uids', {
  id: int('id').primaryKey({ autoIncrement: true }),
  uid: text('uid').notNull(),
  propertyId: int('property_id')
    .notNull()
    .unique()
    .references(() => properties.id),
})

export const propertyUidRelations = relations(propertyUids, ({ one }) => ({
  property: one(properties),
}))

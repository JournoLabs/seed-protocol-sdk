import { blob, int, sqliteTable, text, check, } from 'drizzle-orm/sqlite-core'
import { sql }                          from 'drizzle-orm'

export const config = sqliteTable('config', {
  id: int('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  text: text('text'),
  json: text('json', {mode: 'json'}),
  blob: blob('blob', {mode: 'buffer'}),
}, () => {
  return {
    // Add a custom check constraint
    atLeastOneNotNull: check('hasValue', sql`key IS NOT NULL OR text IS NOT NULL OR json IS NOT NULL OR blob IS NOT NULL`),
  }
})
import { int, sqliteTable, text, check, blob, } from 'drizzle-orm/sqlite-core'
import { InferSelectModel, sql } from 'drizzle-orm'

export const config = sqliteTable(
  'config',
  {
    id: int('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    text: text('text'),
    json: text('json', {mode: 'json'}),
    blob: blob('blob', {mode: 'buffer'}),
},
{
  checks: [
    check('hasValue', sql`key IS NOT NULL OR text IS NOT NULL OR json IS NOT NULL OR blob IS NOT NULL`),
  ],
})

export type configType = InferSelectModel<typeof config>
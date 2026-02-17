import { integer, sqliteTable, text, blob, } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'

export const config = sqliteTable(
  'config',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    key: text('key').notNull(),
    text: text('text'),
    json: text('json'),
    blob: blob('blob'),
  }
)

export type configType = InferSelectModel<typeof config>
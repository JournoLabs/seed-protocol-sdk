import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'
export const appState = sqliteTable('appState', {
  key: text('key').unique(),
  value: text('value'),
  createdAt: int('created_at'),
  updatedAt: int('updated_at'),
})

export type appStateType = InferSelectModel<typeof appState>

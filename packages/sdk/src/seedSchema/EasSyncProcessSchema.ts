import { InferSelectModel } from 'drizzle-orm'
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const easSyncProcesses = sqliteTable('eas_sync_processes', {
  id: int('id').primaryKey({ autoIncrement: true }),
  status: text('status').notNull(), // 'in_progress' | 'completed' | 'failed'
  startedAt: int('started_at').notNull(),
  completedAt: int('completed_at'),
  requestPayload: text('request_payload').notNull(),
  errorMessage: text('error_message'),
  errorDetails: text('error_details'),
  persistedSnapshot: text('persisted_snapshot').notNull(),
  createdAt: int('created_at'),
  updatedAt: int('updated_at'),
})

export type EasSyncProcessType = InferSelectModel<typeof easSyncProcesses>

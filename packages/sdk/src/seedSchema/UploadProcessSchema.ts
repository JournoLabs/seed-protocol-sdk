import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { InferSelectModel } from 'drizzle-orm'

export const uploadProcesses = sqliteTable('upload_processes', {
  id: int('id').primaryKey({ autoIncrement: true }),
  reimbursementConfirmed: int('reimbursement_confirmed').notNull(), // 0 or 1 for boolean
  reimbursementTransactionId: text('reimbursement_transaction_id'),
  transactionKeys: text('transaction_keys'),
  persistedSnapshot: text('persisted_snapshot').notNull(), // JSON string
  createdAt: int('created_at'),
  updatedAt: int('updated_at'),
})

export type UploadProcessType = InferSelectModel<typeof uploadProcesses>

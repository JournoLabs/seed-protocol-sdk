import { BaseDb, uploadProcesses } from '@seedprotocol/sdk'
import { createActor } from 'xstate'
import { or, eq } from 'drizzle-orm'
import { subscribeToProcess } from '../shared'
import { uploadMachine } from './uploadMachine'
import type { UploadMachineContext } from './uploadMachine'
import type { SnapshotFrom } from 'xstate'

export interface UploadProcessRecord {
  id?: number
  reimbursementConfirmed: boolean
  reimbursementTransactionId?: string
  transactionKeys?: string
  persistedSnapshot: unknown
  createdAt?: number
  updatedAt?: number
}

type UploadProcessParams = {
  reimbursementTransactionId?: string
  transactionKeys?: string
}

async function getUploadProcessFromDb(params: UploadProcessParams): Promise<UploadProcessRecord | undefined> {
  const db = BaseDb.getAppDb()
  if (!db) return undefined

  const { reimbursementTransactionId, transactionKeys } = params

  const whereClause =
    transactionKeys && reimbursementTransactionId
      ? or(
          eq(uploadProcesses.transactionKeys, transactionKeys),
          eq(uploadProcesses.reimbursementTransactionId, reimbursementTransactionId)
        )
      : transactionKeys
        ? eq(uploadProcesses.transactionKeys, transactionKeys)
        : reimbursementTransactionId
          ? eq(uploadProcesses.reimbursementTransactionId, reimbursementTransactionId)
          : undefined

  if (!whereClause) return undefined

  const rows = await db.select().from(uploadProcesses).where(whereClause).limit(1)

  const row = rows[0]
  if (!row) return undefined

  let persistedSnapshot: unknown
  try {
    persistedSnapshot = typeof row.persistedSnapshot === 'string' ? JSON.parse(row.persistedSnapshot) : row.persistedSnapshot
  } catch {
    persistedSnapshot = row.persistedSnapshot
  }

  return {
    id: row.id,
    reimbursementConfirmed: row.reimbursementConfirmed === 1,
    reimbursementTransactionId: row.reimbursementTransactionId ?? undefined,
    transactionKeys: row.transactionKeys ?? undefined,
    persistedSnapshot,
    createdAt: row.createdAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
  }
}

export async function saveUploadProcessToDb(params: {
  persistedSnapshot: SnapshotFrom<typeof uploadMachine>
  reimbursementTransactionId?: string
  transactionKeys?: string
  reimbursementConfirmed?: boolean
}): Promise<void> {
  const { persistedSnapshot, reimbursementTransactionId, transactionKeys, reimbursementConfirmed } = params

  if (!persistedSnapshot) {
    throw new Error('No persisted snapshot given for save to db')
  }

  const db = BaseDb.getAppDb()
  if (!db) return

  const snapshotStr = typeof persistedSnapshot === 'string' ? persistedSnapshot : JSON.stringify(persistedSnapshot)
  const now = Date.now()
  const confirmed = reimbursementConfirmed ?? false

  const existing = await getUploadProcessFromDb({ reimbursementTransactionId, transactionKeys })

  if (!existing) {
    await db.insert(uploadProcesses).values({
      reimbursementConfirmed: confirmed ? 1 : 0,
      reimbursementTransactionId: reimbursementTransactionId ?? null,
      transactionKeys: transactionKeys ?? null,
      persistedSnapshot: snapshotStr,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    if (existing.reimbursementConfirmed && !reimbursementConfirmed) return
    if (existing.reimbursementTransactionId && !reimbursementTransactionId) return
    if (existing.transactionKeys && !transactionKeys) return

    await db
      .update(uploadProcesses)
      .set({
        reimbursementConfirmed: confirmed ? 1 : 0,
        reimbursementTransactionId: reimbursementTransactionId ?? null,
        transactionKeys: transactionKeys ?? null,
        persistedSnapshot: snapshotStr,
        updatedAt: now,
      })
      .where(eq(uploadProcesses.id, existing.id!))
  }
}

export async function getUploadProcess(
  context: Partial<UploadMachineContext>
): Promise<import('xstate').ActorRefFrom<typeof uploadMachine> | undefined> {
  const { reimbursementTransactionId, transactionKeys } = context
  const uploadProcessRecord = await getUploadProcessFromDb({ reimbursementTransactionId, transactionKeys })

  const saveFn = async (params: { persistedSnapshot: unknown }) => {
    const snap = params.persistedSnapshot as SnapshotFrom<typeof uploadMachine>
    const ctx = (snap as { context?: UploadMachineContext }).context
    await saveUploadProcessToDb({
      persistedSnapshot: snap,
      reimbursementTransactionId: ctx?.reimbursementTransactionId,
      transactionKeys: ctx?.transactionKeys,
      reimbursementConfirmed: ctx?.reimbursementConfirmed,
    })
  }

  if (uploadProcessRecord?.persistedSnapshot) {
    const uploadProcess = createActor(uploadMachine, {
      snapshot: uploadProcessRecord.persistedSnapshot as SnapshotFrom<typeof uploadMachine>,
    })
    return subscribeToProcess(uploadProcess, saveFn)
  }

  const uploadProcess = createActor(uploadMachine, {
    input: context as UploadMachineContext,
  })
  return subscribeToProcess(uploadProcess, saveFn)
}

export async function startUpload(
  context: Partial<UploadMachineContext>
): Promise<import('xstate').ActorRefFrom<typeof uploadMachine> | undefined> {
  const { transactionKeys, reimbursementTransactionId } = context

  if (!transactionKeys && !reimbursementTransactionId) {
    throw new Error('No transaction keys or reimbursement transaction id')
  }

  const uploadProcess = await getUploadProcess(context)
  if (!uploadProcess) {
    throw new Error(
      `No upload process found for reimbursement transaction: ${reimbursementTransactionId} or transaction keys ${transactionKeys}`
    )
  }

  uploadProcess.start()
  return uploadProcess
}

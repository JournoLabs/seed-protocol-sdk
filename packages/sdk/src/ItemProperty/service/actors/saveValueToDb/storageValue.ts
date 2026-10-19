import type { PropertyMachineContext } from '@/types/property'
import type { ItemStorageValueOp, StorageValueOp, SetPropertyValueResult } from '@/outbox/itemAppliers'
import { getSeedData } from '@/db/read/getSeedData'
import { rowContext } from './rowContext'
import type { PropertyWriteTicket } from '@/helpers/propertyWriteTickets'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'

/** The file a storage value wrote for itself (not one it only refers to). */
const ownFileOf = (value: StorageValueOp | ItemStorageValueOp): string | undefined =>
  'itemStorage' in value ? value.itemStorage.stagedPath : value.ownedFilePath

async function deleteFile(path: string): Promise<void> {
  if (!(await BaseFileManager.pathExists(path))) return
  const fs = await BaseFileManager.getFs()
  if (fs?.promises?.unlink) await fs.promises.unlink(path)
  else fs?.unlinkSync?.(path)
}

/**
 * Writes a storage value (Html, File, Image, ItemStorage) through the outbox (ADR 0019) and waits
 * until it is applied. The value's file (or staged file) is already written. Skipped (the context
 * is left alone) when a newer value of the property superseded it; that value's save sets the
 * context instead, as is a save that a newer save of the property (in this tab) started after:
 * its file is deleted and nothing is appended. `result` is what the op's applier returned.
 */
export async function writeStorageValue<Result extends SetPropertyValueResult = SetPropertyValueResult>(
  item: { seedLocalId?: string | null; seedUid?: string | null; propertyName: string },
  value: StorageValueOp | ItemStorageValueOp,
  ticket: PropertyWriteTicket | undefined,
): Promise<{ skipped: true } | { skipped: false; row: Partial<PropertyMachineContext>; result: Result | undefined }> {
  const seedLocalId =
    item.seedLocalId || (item.seedUid ? (await getSeedData({ seedUid: item.seedUid }))?.localId : undefined)
  if (!seedLocalId) {
    throw new Error(`No local seed for the item to save ${item.propertyName} to`)
  }
  const { appendOutboxOp, getOutboxOps, outboxOpResult, startItemOutbox, throwItemWriteError, waitForOutboxOp } =
    await import('@/outbox')
  startItemOutbox()
  // Checked right before appending (no await in between): ops apply in append order
  if (ticket && !ticket.isLatest()) {
    const own = ownFileOf(value)
    if (own) await deleteFile(own)
    return { skipped: true }
  }
  const opId = await appendOutboxOp({
    seedLocalId,
    propertyName: item.propertyName,
    kind: 'storage',
    value,
  })
  await waitForOutboxOp(opId).catch(throwItemWriteError)
  const [op] = await getOutboxOps([opId])
  if (op?.status !== 'applied') return { skipped: true }
  const result = outboxOpResult<Result>(op) ?? undefined
  return { skipped: false, row: rowContext(result ?? undefined), result }
}

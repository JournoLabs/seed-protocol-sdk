import type { PropertyMachineContext } from '@/types/property'
import type { StorageValueOp, SetPropertyValueResult } from '@/outbox/itemAppliers'
import { getSeedData } from '@/db/read/getSeedData'
import { rowContext } from './rowContext'

/**
 * Writes an Html, File or Image value's rows through the outbox (ADR 0019) and waits until they
 * are applied. The value's file is already written. Skipped (the context is left alone) when a
 * newer value of the property superseded it; that value's save sets the context instead.
 */
export async function writeStorageValue(
  item: { seedLocalId?: string | null; seedUid?: string | null; propertyName: string },
  value: StorageValueOp,
): Promise<{ skipped: true } | { skipped: false; row: Partial<PropertyMachineContext> }> {
  const seedLocalId =
    item.seedLocalId || (item.seedUid ? (await getSeedData({ seedUid: item.seedUid }))?.localId : undefined)
  if (!seedLocalId) {
    throw new Error(`No local seed for the item to save ${item.propertyName} to`)
  }
  const { appendOutboxOp, getOutboxOps, outboxOpResult, startItemOutbox, waitForOutboxOp } = await import('@/outbox')
  startItemOutbox()
  const opId = await appendOutboxOp({
    seedLocalId,
    propertyName: item.propertyName,
    kind: 'storage',
    value,
  })
  await waitForOutboxOp(opId)
  const [op] = await getOutboxOps([opId])
  if (op?.status !== 'applied') return { skipped: true }
  return { skipped: false, row: rowContext(outboxOpResult<SetPropertyValueResult>(op) ?? undefined) }
}

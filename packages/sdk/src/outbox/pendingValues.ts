import { and, desc, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { pendingWrites } from '@/seedSchema/PendingWriteSchema'
import { outboxOpValue } from './outbox'
import type { SetPropertyValueOp } from './itemAppliers'

/**
 * The value an item property will have once its pending `set` ops apply: the newest one's, in its
 * stored string form. Undefined when it has none. A property read from the database takes this
 * over the stored row (ADR 0019), so a value assigned before a reload shows while its op waits.
 */
export async function getPendingSetValue(
  seedLocalId: string | null | undefined,
  propertyName: string | null | undefined,
): Promise<string | null | undefined> {
  if (!seedLocalId || !propertyName) return undefined
  const db = BaseDb.getAppDb()
  if (!db) return undefined
  const [op] = await db
    .select({ value: pendingWrites.value })
    .from(pendingWrites)
    .where(
      and(
        eq(pendingWrites.seedLocalId, seedLocalId),
        eq(pendingWrites.propertyName, propertyName),
        eq(pendingWrites.kind, 'set'),
        eq(pendingWrites.status, 'pending'),
      ),
    )
    .orderBy(desc(pendingWrites.id))
    .limit(1)
  return op ? (outboxOpValue<SetPropertyValueOp>(op)?.newValue ?? null) : undefined
}

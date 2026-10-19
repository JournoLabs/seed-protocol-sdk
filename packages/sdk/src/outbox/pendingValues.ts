import { and, desc, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { pendingWrites } from '@/seedSchema/PendingWriteSchema'
import { outboxAppendGeneration, outboxOpValue } from './outbox'
import type { SetPropertyValueOp } from './itemAppliers'

type PendingSetValues = Map<string, string | null>

/**
 * One read per item while it's in flight: an item's properties load together and would otherwise
 * each send the same query. A read is shared only by callers that start before this tab appends
 * another op, so none of them misses a value assigned before it asked.
 */
const inFlight = new Map<string, { generation: number; read: Promise<PendingSetValues> }>()

const readPendingSetValues = async (seedLocalId: string): Promise<PendingSetValues> => {
  const ops = await BaseDb.getAppDb()
    .select({ propertyName: pendingWrites.propertyName, value: pendingWrites.value })
    .from(pendingWrites)
    .where(
      and(
        eq(pendingWrites.seedLocalId, seedLocalId),
        eq(pendingWrites.kind, 'set'),
        eq(pendingWrites.status, 'pending'),
      ),
    )
    .orderBy(desc(pendingWrites.id))
  const values: PendingSetValues = new Map()
  for (const op of ops) {
    if (!op.propertyName || values.has(op.propertyName)) continue
    values.set(op.propertyName, outboxOpValue<SetPropertyValueOp>(op)?.newValue ?? null)
  }
  return values
}

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
  if (!BaseDb.getAppDb()) return undefined
  const generation = outboxAppendGeneration()
  let entry = inFlight.get(seedLocalId)
  if (!entry || entry.generation !== generation) {
    const read = readPendingSetValues(seedLocalId)
    const created = { generation, read }
    entry = created
    inFlight.set(seedLocalId, created)
    const forget = () => {
      if (inFlight.get(seedLocalId) === created) inFlight.delete(seedLocalId)
    }
    read.then(forget, forget)
  }
  const values = await entry.read
  return values.has(propertyName) ? values.get(propertyName) : undefined
}

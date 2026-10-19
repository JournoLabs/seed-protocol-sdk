import { and, asc, eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { pendingWrites } from '@/seedSchema/PendingWriteSchema'
import type { MetadataType } from '@/seedSchema'
import { outboxOpValue, type OutboxOp } from './outbox'
import type { ItemStorageValueOp, SetPropertyValueOp, StorageValueOp } from './itemAppliers'

/**
 * What a property's row will hold once its pending value ops apply (ADR 0019's read overlay): the
 * newest pending `set` or `storage` op's fields. A reader puts these over the stored row, so a value
 * assigned before a reload, or in another tab, shows while its op waits.
 */
export type PendingPropertyRow = Partial<
  Pick<
    MetadataType,
    'propertyValue' | 'refSeedType' | 'refResolvedValue' | 'refResolvedDisplayValue' | 'localStorageDir'
  >
> & {
  /** An ItemStorage value's staged file, which holds the content until the op moves it into place. */
  stagedPath?: string
}

const isItemStorageOp = (value: unknown): value is ItemStorageValueOp =>
  typeof value === 'object' && value !== null && 'itemStorage' in value

function overlayOf(op: Pick<OutboxOp, 'kind' | 'value'>): PendingPropertyRow | undefined {
  if (op.kind === 'set') {
    const value = outboxOpValue<SetPropertyValueOp>(op)
    return value ? { propertyValue: value.newValue ?? null } : undefined
  }
  const value = outboxOpValue<StorageValueOp | ItemStorageValueOp>(op)
  if (!value) return undefined
  if (isItemStorageOp(value)) return { stagedPath: value.itemStorage.stagedPath }
  const fields = value.create.values
  return {
    propertyValue: (fields.propertyValue as string | null | undefined) ?? value.storageSeed.localId,
    refSeedType: fields.refSeedType ?? value.storageSeed.type,
    refResolvedValue: fields.refResolvedValue ?? null,
    refResolvedDisplayValue: fields.refResolvedDisplayValue ?? null,
    localStorageDir: fields.localStorageDir ?? null,
  }
}

/** Html, Image, File and Relation rows are stored as `<name>Id`; match either spelling. */
export const propertyNameVariants = (name: string): string[] =>
  name.endsWith('Id') ? [name, name.slice(0, -2)] : [name, `${name}Id`]

/**
 * The pending row of each of the seed's properties that has a pending value op, keyed by the op's
 * property name. Only `propertyNames` (either spelling) when given.
 */
export async function getPendingPropertyRows(
  seedLocalId: string | null | undefined,
  propertyNames?: string[],
): Promise<Map<string, PendingPropertyRow>> {
  const rows = new Map<string, PendingPropertyRow>()
  if (!seedLocalId) return rows
  const db = BaseDb.getAppDb()
  if (!db) return rows
  const names = propertyNames?.flatMap(propertyNameVariants)
  const ops: Array<Pick<OutboxOp, 'kind' | 'value' | 'propertyName'>> = await db
    .select({ kind: pendingWrites.kind, value: pendingWrites.value, propertyName: pendingWrites.propertyName })
    .from(pendingWrites)
    .where(
      and(
        eq(pendingWrites.seedLocalId, seedLocalId),
        eq(pendingWrites.status, 'pending'),
        inArray(pendingWrites.kind, ['set', 'storage']),
        ...(names ? [inArray(pendingWrites.propertyName, names)] : []),
      ),
    )
    .orderBy(asc(pendingWrites.id))
  // Oldest first, so the newest op's row is the one kept
  for (const op of ops) {
    if (!op.propertyName) continue
    const overlay = overlayOf(op)
    if (overlay) rows.set(op.propertyName, overlay)
  }
  return rows
}

/** One property's pending row (see getPendingPropertyRows); undefined when it has none. */
export async function getPendingPropertyRow(
  seedLocalId: string | null | undefined,
  propertyName: string | null | undefined,
): Promise<PendingPropertyRow | undefined> {
  if (!propertyName) return undefined
  const rows = await getPendingPropertyRows(seedLocalId, [propertyName])
  for (const name of propertyNameVariants(propertyName)) {
    const row = rows.get(name)
    if (row) return row
  }
  return undefined
}

/**
 * The value an item property will have once its pending `set` ops apply, in its stored string form.
 * Undefined when its newest pending value op is not a `set`, or it has none.
 */
export async function getPendingSetValue(
  seedLocalId: string | null | undefined,
  propertyName: string | null | undefined,
): Promise<string | null | undefined> {
  const row = await getPendingPropertyRow(seedLocalId, propertyName)
  if (!row || row.stagedPath || row.refSeedType) return undefined
  return row.propertyValue
}

/** Puts a pending row's fields over a stored row (not `stagedPath`, which isn't a column). */
export function applyPendingRow<Row extends Partial<MetadataType>>(row: Row, pending: PendingPropertyRow): Row {
  const { stagedPath: _stagedPath, ...fields } = pending
  return { ...row, ...fields }
}

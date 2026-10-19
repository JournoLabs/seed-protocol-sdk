/**
 * Conflicts between a pending local edit and a value sync wrote meanwhile (ADR 0019). The local
 * edit wins: it applies over the synced row as a new draft. The conflict is recorded on the op that
 * applied, so the app can show both values and let the user pick.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { pendingWrites } from '@/seedSchema/PendingWriteSchema'
import { getMetadataPropertyNamesForQuery } from '@/helpers/metadataPropertyNames'
import { METADATA_LATEST_FIRST_ORDER_SQL } from '@/helpers/compareMetadataRowsLatestFirst'
import type { OutboxOp } from './outbox'

/** Values are in their stored string form (a List as JSON, a Relation as the related seed's id). */
export type PropertyConflict = {
  seedLocalId: string
  propertyName: string
  /** The stored value the local edit was made against; null when the property had no row. */
  baseValue: string | null
  /** The synced value the local edit was applied over. */
  remoteValue: string | null
  /** The local edit's value, which is the property's value now. */
  localValue: string | null
  /** The attestation uid of the synced value. */
  remoteUid: string
  /** The outbox op that recorded it. */
  opId: string
}

type Db = ReturnType<typeof BaseDb.getAppDb>

/**
 * The conflict a `set` op meets when it applies: sync wrote an attested row for the property after
 * the edit was made, and its value differs from both the value the edit was made against and the
 * edit's own. A row with the base row's uid (the same attestation synced again) is not a conflict,
 * nor is a published row carrying the base value (a publish of the edit's base). Reads through `db`
 * (the op's transaction).
 */
export async function findSetConflict(
  op: Pick<OutboxOp, 'opId' | 'seedLocalId' | 'propertyName' | 'baseRowId' | 'createdAt'>,
  value: { newValue: string | null; dataType?: string; refValueType?: string },
  db: Db,
): Promise<PropertyConflict | null> {
  if (!op.propertyName) return null
  const names = getMetadataPropertyNamesForQuery(op.propertyName, value.dataType, value.refValueType)
  const [newest] = await db
    .select({
      localId: metadata.localId,
      uid: metadata.uid,
      propertyValue: metadata.propertyValue,
      createdAt: metadata.createdAt,
    })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, op.seedLocalId), inArray(metadata.propertyName, names)))
    .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))
    .limit(1)
  if (!newest?.uid || newest.localId === op.baseRowId) return null

  const [base] = op.baseRowId
    ? await db
        .select({ uid: metadata.uid, propertyValue: metadata.propertyValue })
        .from(metadata)
        .where(eq(metadata.localId, op.baseRowId))
        .limit(1)
    : []
  if (base?.uid && base.uid === newest.uid) return null
  // With no base row, only a row written after the edit counts: an older one was there to see
  if (!base && (newest.createdAt ?? 0) <= op.createdAt) return null
  const baseValue = base?.propertyValue ?? null
  const remoteValue = newest.propertyValue ?? null
  if (remoteValue === baseValue || remoteValue === value.newValue) return null
  return {
    seedLocalId: op.seedLocalId,
    propertyName: op.propertyName,
    baseValue,
    remoteValue,
    localValue: value.newValue,
    remoteUid: newest.uid,
    opId: op.opId,
  }
}

/**
 * Records `conflict` on the op that met it, and clears the property's earlier conflicts: a newer
 * local edit settles them (it was made with the synced value in view, or overrides it again).
 */
export async function recordPropertyEdit(
  op: Pick<OutboxOp, 'id' | 'opId' | 'seedLocalId' | 'propertyName'>,
  conflict: PropertyConflict | null,
  db: Db,
): Promise<void> {
  if (!op.propertyName) return
  await db
    .update(pendingWrites)
    .set({ conflictResolvedAt: Date.now() })
    .where(
      and(
        eq(pendingWrites.seedLocalId, op.seedLocalId),
        eq(pendingWrites.propertyName, op.propertyName),
        lt(pendingWrites.id, op.id),
        isNotNull(pendingWrites.conflict),
        isNull(pendingWrites.conflictResolvedAt),
      ),
    )
  if (conflict) {
    await db.update(pendingWrites).set({ conflict: JSON.stringify(conflict) }).where(eq(pendingWrites.opId, op.opId))
  }
}

const unresolved = (seedLocalId: string) =>
  and(
    eq(pendingWrites.status, 'applied'),
    eq(pendingWrites.seedLocalId, seedLocalId),
    isNotNull(pendingWrites.conflict),
    isNull(pendingWrites.conflictResolvedAt),
  )

const parse = (row: { conflict: string | null }): PropertyConflict | null => {
  try {
    return row.conflict ? (JSON.parse(row.conflict) as PropertyConflict) : null
  } catch {
    return null
  }
}

/** The item's unresolved conflicts, the newest per property. */
export async function getItemConflicts(seedLocalId: string): Promise<PropertyConflict[]> {
  const db = BaseDb.getAppDb()
  if (!db || !seedLocalId) return []
  const rows = await db
    .select({ propertyName: pendingWrites.propertyName, conflict: pendingWrites.conflict })
    .from(pendingWrites)
    .where(unresolved(seedLocalId))
    .orderBy(desc(pendingWrites.id))
  const seen = new Set<string>()
  const conflicts: PropertyConflict[] = []
  for (const row of rows) {
    if (!row.propertyName || seen.has(row.propertyName)) continue
    seen.add(row.propertyName)
    const conflict = parse(row)
    if (conflict) conflicts.push(conflict)
  }
  return conflicts
}

/** The property's unresolved conflict, if it has one. */
export async function getPropertyConflict(
  seedLocalId: string | null | undefined,
  propertyName: string | null | undefined,
): Promise<PropertyConflict | null> {
  if (!seedLocalId || !propertyName) return null
  const db = BaseDb.getAppDb()
  if (!db) return null
  const [row] = await db
    .select({ conflict: pendingWrites.conflict })
    .from(pendingWrites)
    .where(and(unresolved(seedLocalId), eq(pendingWrites.propertyName, propertyName)))
    .orderBy(desc(pendingWrites.id))
    .limit(1)
  return row ? parse(row) : null
}

/** Marks the property's conflicts resolved. */
export async function markPropertyConflictsResolved(seedLocalId: string, propertyName: string): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  await db
    .update(pendingWrites)
    .set({ conflictResolvedAt: Date.now() })
    .where(and(unresolved(seedLocalId), eq(pendingWrites.propertyName, propertyName)))
}

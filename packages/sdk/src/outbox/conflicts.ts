/**
 * Conflicts between a local edit and a value sync wrote after it (ADR 0019). The local edit wins:
 * a pending edit applies over the synced row as a new draft, and a draft already written stays the
 * newest row. The conflict is recorded on an op row, so the app can show both values and let the
 * user pick.
 */
import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { generateId } from '@/helpers/generateId'
import { isPlaceholderUid } from '@/helpers/easUid'
import { selectInBatches } from '@/db/sqlParamBatches'
import { eventEmitter } from '@/eventBus'
import { propertyNameVariants } from './pendingValues'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { pendingWrites } from '@/seedSchema/PendingWriteSchema'
import { matchMetadataProperty, metadataRowsOfProperty, sameMetadataProperty } from '@/db/read/metadataProperty'
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
  value: { newValue: string | null; dataType?: string; refValueType?: string; modelName?: string | null },
  db: Db,
): Promise<PropertyConflict | null> {
  if (!op.propertyName) return null
  const property = await matchMetadataProperty(
    {
      propertyName: op.propertyName,
      seedLocalId: op.seedLocalId,
      modelName: value.modelName,
      dataType: value.dataType,
      refValueType: value.refValueType,
    },
    db,
  )
  const [newest] = await db
    .select({
      localId: metadata.localId,
      uid: metadata.uid,
      propertyValue: metadata.propertyValue,
      createdAt: metadata.createdAt,
    })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, op.seedLocalId), metadataRowsOfProperty(property)))
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
    .where(and(unresolved(seedLocalId), inArray(pendingWrites.propertyName, propertyNameVariants(propertyName))))
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
    .where(and(unresolved(seedLocalId), inArray(pendingWrites.propertyName, propertyNameVariants(propertyName))))
}

type SyncedRow = {
  localId?: string | null
  propertyId?: number | null
  uid?: string | null
  seedLocalId?: string | null
  propertyName?: string | null
  propertyValue?: string | null
  attestationCreatedAt?: number | null
  revokedAt?: number | null
}

/**
 * The conflict rule for rows sync just inserted (`synced`) over a local draft already written: the
 * draft stays the property's value. When a synced row is newer than the draft, the draft's time is
 * moved just past it (readers take the newest row). A conflict is recorded, on an `applied` op row
 * of its own, when the synced value differs from both the draft's and the attested value the draft
 * replaced. Properties with a pending value op are left to the drainer, which applies the same rule.
 */
export async function keepLocalDraftsOverSyncedRows(synced: SyncedRow[]): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  const live = synced.filter((row) => row.seedLocalId && row.propertyName && row.uid && row.revokedAt == null)
  if (live.length === 0) return
  const seedIds = [...new Set(live.map((row) => row.seedLocalId!))]
  const candidates: Array<typeof metadata.$inferSelect> = await selectInBatches(seedIds, (chunk) =>
    db
      .select()
      .from(metadata)
      .where(and(inArray(metadata.seedLocalId, chunk), isNull(metadata.derivedFromUid), isNull(metadata.revokedAt))),
  )
  const drafts = candidates.filter((row) => isPlaceholderUid(row.uid))
  if (drafts.length === 0) return

  const syncedIds = new Set(live.map((row) => row.localId ?? ''))
  for (const draft of drafts) {
    // Paired by property_id (decision D4): a draft stored as `author` and a synced `authorId` row
    // of the same property are one property. Rows without one pair by name.
    const key = (row: { seedLocalId?: string | null; propertyId?: number | null; propertyName?: string | null }) =>
      row.seedLocalId === draft.seedLocalId && sameMetadataProperty(row, draft)
    const remote = live
      .filter(key)
      .sort((a, b) => (b.attestationCreatedAt ?? 0) - (a.attestationCreatedAt ?? 0))[0]
    if (!remote || !draft.localId || !draft.seedLocalId || !draft.propertyName) continue

    const [pending] = await db
      .select({ id: pendingWrites.id })
      .from(pendingWrites)
      .where(
        and(
          eq(pendingWrites.seedLocalId, draft.seedLocalId),
          inArray(pendingWrites.propertyName, propertyNameVariants(draft.propertyName)),
          eq(pendingWrites.status, 'pending'),
        ),
      )
      .limit(1)
    if (pending) continue

    const now = Date.now()
    const remoteAt = remote.attestationCreatedAt ?? 0
    if (remoteAt >= (draft.createdAt ?? 0)) {
      await db
        .update(metadata)
        .set({ createdAt: remoteAt + 1 })
        .where(eq(metadata.localId, draft.localId))
    }

    // The attested value the draft replaced: the newest attested row that sync didn't just write
    const base = candidates
      .filter((row) => key(row) && !isPlaceholderUid(row.uid) && !syncedIds.has(row.localId ?? ''))
      .sort((a, b) => (b.attestationCreatedAt ?? 0) - (a.attestationCreatedAt ?? 0))[0]
    const baseValue = base?.propertyValue ?? null
    const remoteValue = remote.propertyValue ?? null
    const localValue = draft.propertyValue ?? null
    if (remoteValue === localValue || remoteValue === baseValue) continue

    const opId = generateId()
    const conflict: PropertyConflict = {
      seedLocalId: draft.seedLocalId,
      propertyName: draft.propertyName,
      baseValue,
      remoteValue,
      localValue,
      remoteUid: remote.uid!,
      opId,
    }
    await db.insert(pendingWrites).values({
      opId,
      seedLocalId: draft.seedLocalId,
      propertyName: draft.propertyName,
      kind: 'set',
      value: JSON.stringify({ newValue: localValue }),
      baseRowId: draft.localId,
      createdAt: now,
      status: 'applied',
      appliedAt: now,
      conflict: JSON.stringify(conflict),
    })
    eventEmitter.emit('itemProperty.conflict', conflict)
  }
}

import { and, eq, or, sql, type SQL } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, type MetadataType } from '@/seedSchema'
import { METADATA_LATEST_FIRST_ORDER_SQL } from '@/helpers/compareMetadataRowsLatestFirst'
import {
  matchMetadataProperty,
  metadataRowsOfProperty,
  type MetadataPropertyMatch,
  type ResolveMetadataPropertyInput,
} from '@/db/read/metadataProperty'
import { getMetadataLatest } from '@/db/read/subqueries/metadataLatest'
import {
  applyPendingRow,
  getPendingPropertyRow,
  getPendingPropertyRows,
  propertyNameVariants,
  type PendingPropertyRow,
} from '@/outbox/pendingValues'

type Db = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

export type PropertyRowSeed = { seedLocalId?: string | null; seedUid?: string | null }

/**
 * The property whose row is wanted: what matchMetadataProperty takes, or its result when the
 * caller already matched (the feed matches once and reads on every change).
 */
export type PropertyRowDef =
  | (Omit<ResolveMetadataPropertyInput, 'seedLocalId' | 'seedUid'> & { dataType?: string; refValueType?: string })
  | { match: MetadataPropertyMatch; propertyName?: string | null }

export type CurrentPropertyRowOptions = {
  /**
   * Put the newest pending outbox op over the stored row (ADR 0019). Default true. Publish passes
   * false: it waits for the seed's ops to apply before it reads.
   */
  overlay?: boolean
  /** The database to read (a transaction's, in an applier). */
  db?: Db
}

/**
 * A property's current row: the stored row, or a pending op's fields over it. `overlaid` is true
 * when a pending op changed what the stored row says; such a row is an unpublished edit, so its
 * attestation fields are cleared. `stagedPath` is a pending ItemStorage value's staged file;
 * `pendingText` a pending Html value's text, shown until its file is written.
 */
export type CurrentPropertyRow = Partial<MetadataType> & {
  overlaid: boolean
  stagedPath?: string
  pendingText?: string
}

const seedWhere = ({ seedLocalId, seedUid }: PropertyRowSeed): SQL | undefined => {
  if (seedLocalId && seedUid) return or(eq(metadata.seedLocalId, seedLocalId), eq(metadata.seedUid, seedUid))
  if (seedLocalId) return eq(metadata.seedLocalId, seedLocalId)
  if (seedUid) return eq(metadata.seedUid, seedUid)
  return undefined
}

/** Stored fields an overlay can't vouch for: the pending value has no attestation yet. */
const unattested = { uid: null, attestationRaw: null, derivedFromUid: null } as const

function overlayRow(
  stored: Partial<MetadataType> | undefined,
  pending: PendingPropertyRow | undefined,
  fallback: Partial<MetadataType>,
): CurrentPropertyRow | undefined {
  if (!pending) return stored ? { ...stored, overlaid: false } : undefined
  const base = stored ?? fallback
  // An ItemStorage op leaves the row's columns alone until it moves the staged file into place
  if (pending.stagedPath !== undefined) {
    return { ...base, overlaid: true, stagedPath: pending.stagedPath, ...unattested }
  }
  if (stored && pending.propertyValue === stored.propertyValue) return { ...stored, overlaid: false }
  return {
    ...applyPendingRow(base, pending),
    ...unattested,
    overlaid: true,
    ...(pending.pendingText !== undefined && { pendingText: pending.pendingText }),
  }
}

async function pendingRowOf(
  seedLocalId: string | null | undefined,
  names: readonly (string | null | undefined)[],
): Promise<PendingPropertyRow | undefined> {
  if (!seedLocalId) return undefined
  for (const name of new Set(names)) {
    const row = await getPendingPropertyRow(seedLocalId, name)
    if (row) return row
  }
  return undefined
}

/**
 * The row that holds a property's value, the one every reader shows (decision D4, ADR 0019):
 *
 * - the property's rows are those linked to it by property_id, plus rows with none stored under
 *   one of its names;
 * - of those, the first by METADATA_LATEST_FIRST_ORDER_SQL;
 * - with `overlay` (the default), the newest pending value op of the property over it, read before
 *   the stored row so an op that applies between the two reads is in one of them.
 *
 * Undefined when the property has no row and no pending value.
 */
export async function currentPropertyRow(
  seed: PropertyRowSeed,
  def: PropertyRowDef,
  options: CurrentPropertyRowOptions = {},
): Promise<CurrentPropertyRow | undefined> {
  const db = options.db ?? BaseDb.getAppDb()
  if (!db) return undefined
  const where = seedWhere(seed)
  if (!where) return undefined
  const overlay = options.overlay ?? true
  const match =
    'match' in def
      ? def.match
      : await matchMetadataProperty({ ...def, seedLocalId: seed.seedLocalId, seedUid: seed.seedUid }, db)
  const propertyName = def.propertyName ?? match.property?.name
  const pendingNames = [propertyName, ...match.names]

  const pendingFirst = overlay ? await pendingRowOf(seed.seedLocalId, pendingNames) : undefined
  const [stored] = (await db
    .select()
    .from(metadata)
    .where(and(where, metadataRowsOfProperty(match)))
    .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))
    .limit(1)) as MetadataType[]
  const pending =
    !overlay ? undefined : seed.seedLocalId ? pendingFirst : await pendingRowOf(stored?.seedLocalId, pendingNames)

  return overlayRow(stored, pending, {
    seedLocalId: seed.seedLocalId ?? stored?.seedLocalId ?? null,
    seedUid: seed.seedUid ?? null,
    propertyName: match.property?.storageName ?? propertyName ?? null,
    propertyId: match.propertyId,
  })
}

/**
 * The current row of each of a seed's properties (see currentPropertyRow), plus a row for each
 * property that has a pending value but no row yet. Rows group by property_id, rows with none by
 * stored name, as getMetadataLatest numbers them. `propertyKey` is the property's schema key.
 */
export async function currentPropertyRows(
  seed: PropertyRowSeed,
  options: CurrentPropertyRowOptions = {},
): Promise<Array<CurrentPropertyRow & { propertyKey?: string | null }>> {
  const db = options.db ?? BaseDb.getAppDb()
  if (!db || (!seed.seedLocalId && !seed.seedUid)) return []
  const overlay = options.overlay ?? true
  const metadataLatest = getMetadataLatest({
    seedLocalId: seed.seedLocalId ?? undefined,
    seedUid: seed.seedUid ?? undefined,
  })

  const pendingFirst = overlay && seed.seedLocalId ? await getPendingPropertyRows(seed.seedLocalId) : undefined
  const stored = (await db
    .with(metadataLatest)
    .select()
    .from(metadataLatest)
    .where(eq(metadataLatest.rowNum, 1))) as Array<MetadataType & { rowNum: unknown; propertyKey: string | null }>
  if (!overlay) return stored.map(({ rowNum: _rowNum, ...row }) => ({ ...row, overlaid: false }))

  const seedLocalId = seed.seedLocalId ?? stored[0]?.seedLocalId
  const pending = pendingFirst ?? (await getPendingPropertyRows(seedLocalId))
  const out = stored.map(({ rowNum: _rowNum, ...row }) => {
    // An op names the property as its instance does: the row's stored name, or its key
    const name = [row.propertyName, row.propertyKey]
      .filter((n): n is string => !!n)
      .flatMap(propertyNameVariants)
      .find((variant) => pending.has(variant))
    const overlaid = name ? pending.get(name) : undefined
    if (name) pending.delete(name)
    return { ...overlayRow(row, overlaid, row)!, propertyKey: row.propertyKey }
  })
  for (const [propertyName, overlaid] of pending) {
    if (overlaid.stagedPath !== undefined) continue
    out.push({ ...overlayRow(undefined, overlaid, { seedLocalId, propertyName })!, propertyKey: null })
  }
  return out
}

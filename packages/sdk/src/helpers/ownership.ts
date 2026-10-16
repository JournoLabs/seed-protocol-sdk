import type { IItem } from '@/interfaces/IItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { getOwnedAddressesFromDb } from '@/helpers/db'
import { isPlaceholderUid } from '@/helpers/easUid'
import { ZERO_BYTES32 } from '@/helpers/constants'
import { normalizeAddressList, normalizeHexAddress } from '@/helpers/addresses'

const READ_ONLY_ERROR = 'Item is read-only: you do not own this item'

/**
 * Thrown by write operations (save, destroy, publish, unpublish) on an item none
 * of the client's addresses own. See isItemOwned for what counts as owned.
 */
export class OwnershipError extends Error {
  constructor(message = READ_ONLY_ERROR) {
    super(message)
    this.name = 'OwnershipError'
    Object.setPrototypeOf(this, OwnershipError.prototype)
  }
}

type ItemLike = { seedLocalId?: string; seedUid?: string }

export type SeedOwnershipRow = {
  publisher: string | null
  attestationRaw?: string | null
  uid?: string | null
}

async function getSeedRowForItem(item: ItemLike): Promise<SeedOwnershipRow | null> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return null

  const selectRow = async (condition: SQL): Promise<SeedOwnershipRow | null> => {
    const seedRows = await appDb
      .select({
        publisher: seeds.publisher,
        attestationRaw: seeds.attestationRaw,
        uid: seeds.uid,
      })
      .from(seeds)
      .where(condition)
      .limit(1)
    return seedRows?.[0] ?? null
  }

  // localId identifies the item's own row; uid may be shared by other local rows
  // (e.g. duplicate syncs), so only fall back to it when there is no localId match.
  if (item.seedLocalId) {
    const row = await selectRow(eq(seeds.localId, item.seedLocalId))
    if (row) return row
  }
  if (item.seedUid) return selectRow(eq(seeds.uid, item.seedUid))
  return null
}

/** Resolve publisher from seed row: `publisher` column, else `attestationRaw.attester`. */
export function resolvePublisherFromSeedRow(row: SeedOwnershipRow): string | null {
  if (row.publisher) return row.publisher
  if (row.attestationRaw) {
    try {
      const parsed = JSON.parse(row.attestationRaw) as { attester?: string }
      return parsed.attester ?? null
    } catch {
      return null
    }
  }
  return null
}

/**
 * Local draft that has never been attested: no publisher, no real uid, no attestationRaw.
 */
export function isLocalUnsealedDraft(row: SeedOwnershipRow): boolean {
  const publisher = row.publisher
  if (publisher != null && publisher !== '') return false
  if (!isPlaceholderUid(row.uid)) return false
  if (row.attestationRaw != null && row.attestationRaw !== '') return false
  return true
}

/** Case-insensitive membership in the persisted owned set. */
export function publisherIsInOwnedSet(
  publisher: string | null | undefined,
  ownedAddresses: readonly string[],
): boolean {
  if (publisher == null || publisher === '') return false
  const ownedSet = new Set(normalizeAddressList(ownedAddresses))
  return ownedSet.has(normalizeHexAddress(publisher))
}

/**
 * Shared ownership predicate.
 * - Session has owned addresses: only a publisher in that set is owned (null is never owned).
 * - Session has no owned addresses: local unsealed drafts are owned so pre-connect authoring works.
 */
export function isSeedRowOwned(
  row: SeedOwnershipRow,
  ownedAddresses: readonly string[],
): boolean {
  const publisher = resolvePublisherFromSeedRow(row)
  if (ownedAddresses.length === 0) {
    return isLocalUnsealedDraft({ ...row, publisher: publisher ?? row.publisher })
  }
  return publisherIsInOwnedSet(publisher, ownedAddresses)
}

/**
 * SQL for an address list on `publisher`. Empty list → no rows (`1=0`).
 * Compares `lower(publisher)` so checksummed rows match persisted lowercase addresses.
 * Used for `addressFilter: 'watched'`; `'owned'` uses {@link ownedSeedsSql}.
 */
export function publisherInAddressListSql(
  column: typeof seeds.publisher,
  addresses: readonly string[],
): SQL {
  const normalized = normalizeAddressList(addresses)
  if (normalized.length === 0) {
    return sql`1=0`
  }
  return inArray(sql<string>`lower(${column})`, normalized) as SQL
}

/**
 * @deprecated Matches `seeds.publisher` only. Use {@link ownedSeedsSql}, which agrees
 * with {@link isSeedRowOwned} (empty owned → local unsealed drafts; attester fallback).
 */
export function ownedPublisherSql(ownedAddresses: readonly string[]): SQL {
  return publisherInAddressListSql(seeds.publisher, ownedAddresses)
}

/** SQL form of {@link isPlaceholderUid}: null, `''`, `'NULL'`, or zero bytes32 (trimmed, any case). */
export function placeholderUidSql(column: typeof seeds.uid): SQL {
  return or(
    isNull(column),
    eq(column, 'NULL'),
    sql`trim(${column}) = ''`,
    sql`lower(trim(${column})) = ${ZERO_BYTES32.toLowerCase()}`,
  ) as SQL
}

const isBlankSql = (column: typeof seeds.publisher | typeof seeds.attestationRaw): SQL =>
  or(isNull(column), eq(column, '')) as SQL

/** SQL form of {@link isLocalUnsealedDraft} on `seeds`. */
export function localUnsealedDraftSql(): SQL {
  return and(
    isBlankSql(seeds.publisher),
    placeholderUidSql(seeds.uid),
    isBlankSql(seeds.attestationRaw),
  ) as SQL
}

/**
 * SQL for `addressFilter: 'owned'`: a row passes exactly when {@link isSeedRowOwned} is true.
 * - Empty owned → local unsealed drafts (pre-connect authoring), not every row.
 * - Owned set → `lower(trim(publisher))` in the set, or, when publisher is blank, the
 *   `attestationRaw.attester` ({@link resolvePublisherFromSeedRow}). `json_valid` guards
 *   `json_extract`, which throws on malformed JSON.
 */
export function ownedSeedsSql(ownedAddresses: readonly string[]): SQL {
  const normalized = normalizeAddressList(ownedAddresses)
  if (normalized.length === 0) {
    return localUnsealedDraftSql()
  }
  const attester = sql`CASE WHEN json_valid(${seeds.attestationRaw}) THEN lower(trim(json_extract(${seeds.attestationRaw}, '$.attester'))) END`
  return or(
    inArray(sql<string>`lower(trim(${seeds.publisher}))`, normalized),
    and(isBlankSql(seeds.publisher), inArray(attester, normalized)),
  ) as SQL
}

/**
 * Checks if the current user owns the item (publisher is in persisted owned addresses).
 *
 * When the session has owned addresses, only a matching publisher is owned —
 * `publisher IS NULL` is not treated as owned. Call `claimUnpublishedDrafts`
 * after connect to stamp local drafts.
 *
 * When owned is empty, local unsealed drafts (no publisher, no real uid, no
 * attestationRaw) are still owned so create/edit works before a wallet is connected.
 *
 * Does not include `getAdditionalSyncAddresses` (those are extra EAS indexers,
 * not wallets the user controls).
 */
export async function isItemOwned(item: ItemLike | IItem<any>): Promise<boolean> {
  const row = await getSeedRowForItem(item)
  if (!row) return false
  const ownedAddresses = await getOwnedAddressesFromDb()
  return isSeedRowOwned(row, ownedAddresses)
}

/**
 * Throws OwnershipError if the item is not owned. Use before write operations
 * (publish, save, destroy).
 */
export async function assertItemOwned(item: ItemLike | IItem<any>): Promise<void> {
  const owned = await isItemOwned(item)
  if (!owned) {
    throw new OwnershipError()
  }
}

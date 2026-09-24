import type { IItem } from '@/interfaces/IItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getOwnedAddressesFromDb } from '@/helpers/db'
import { isPlaceholderUid } from '@/helpers/easUid'
import { normalizeAddressList, normalizeHexAddress } from '@/helpers/addresses'

const READ_ONLY_ERROR = 'Item is read-only: you do not own this item'

type ItemLike = { seedLocalId?: string; seedUid?: string }

export type SeedOwnershipRow = {
  publisher: string | null
  attestationRaw?: string | null
  uid?: string | null
}

async function getSeedRowForItem(item: ItemLike): Promise<SeedOwnershipRow | null> {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return null

  const conditions = []
  if (item.seedLocalId) conditions.push(eq(seeds.localId, item.seedLocalId))
  if (item.seedUid) conditions.push(eq(seeds.uid, item.seedUid))
  if (conditions.length === 0) return null

  const seedRows = await appDb
    .select({
      publisher: seeds.publisher,
      attestationRaw: seeds.attestationRaw,
      uid: seeds.uid,
    })
    .from(seeds)
    .where(conditions.length === 1 ? conditions[0] : (or(...conditions) as any))
    .limit(1)

  if (!seedRows || seedRows.length === 0) return null
  return seedRows[0]
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
 * SQL for `addressFilter: 'owned' | 'watched'`. Empty list → no rows (`1=0`).
 * Compares `lower(publisher)` so checksummed rows match persisted lowercase owned.
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

/** Owned-list SQL on `seeds.publisher`. */
export function ownedPublisherSql(ownedAddresses: readonly string[]): SQL {
  return publisherInAddressListSql(seeds.publisher, ownedAddresses)
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
 * Throws if the item is not owned. Use before write operations (publish, save, destroy).
 */
export async function assertItemOwned(item: ItemLike | IItem<any>): Promise<void> {
  const owned = await isItemOwned(item)
  if (!owned) {
    throw new Error(READ_ONLY_ERROR)
  }
}

import type { IItem } from '@/interfaces/IItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq, or } from 'drizzle-orm'
import { getOwnedAddressesFromDb } from '@/helpers/db'
import { getGetAdditionalSyncAddresses } from '@/helpers/publishConfig'

const READ_ONLY_ERROR = 'Item is read-only: you do not own this item'

type ItemLike = { seedLocalId?: string; seedUid?: string }

type SeedRow = { publisher: string | null; attestationRaw: string | null; uid: string | null }

async function getSeedRowForItem(item: ItemLike): Promise<SeedRow | null> {
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

function getPublisherFromRow(row: SeedRow): string | null {
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
 * Checks if the current user owns the item (publisher is in owned addresses).
 * Locally created items (no publisher, no attestationRaw) are considered owned.
 * Includes getAdditionalSyncAddresses (e.g. modular executor contract) so ownership
 * aligns with EAS sync - items attested by the executor are considered owned.
 */
export async function isItemOwned(item: ItemLike | IItem<any>): Promise<boolean> {
  const row = await getSeedRowForItem(item)
  if (!row) return false

  const publisher = getPublisherFromRow(row)
  if (!publisher) {
    if (!row.uid && !row.attestationRaw) {
      return true
    }
    return false
  }

  let addressesToCheck = await getOwnedAddressesFromDb()
  const additionalGetter = getGetAdditionalSyncAddresses()
  if (additionalGetter) {
    const additional = await additionalGetter()
    if (additional?.length) {
      const seen = new Set(addressesToCheck.map((a) => a.toLowerCase()))
      for (const addr of additional) {
        if (addr && !seen.has(addr.toLowerCase())) {
          seen.add(addr.toLowerCase())
          addressesToCheck = [...addressesToCheck, addr]
        }
      }
    }
  }

  const ownedSet = new Set(addressesToCheck.map((a) => a.toLowerCase()))
  return ownedSet.has(publisher.toLowerCase())
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

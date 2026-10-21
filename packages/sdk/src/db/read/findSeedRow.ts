import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import type { SeedType } from '@/seedSchema'
import { ZERO_BYTES32 } from '@/helpers/constants'
import { findSeedRowsByUid } from './findSeedRowsByUid'

/** A seed row found by {@link findSeedRow}; rows without a local id are never returned. */
export type FoundSeedRow = SeedType & { localId: string }

/**
 * The local seed row for an item known by local id, seed uid or both. The local id wins: it names
 * one row, while a uid can be an old one the seed held before it was unpublished and published
 * again. A uid (when the local id is absent or matches nothing) resolves as
 * {@link findSeedRowsByUid} resolves it: the seed whose versions record it (`versions.seed_uid`),
 * else the row with that `seeds.uid`. The zero uid matches nothing.
 */
export const findSeedRow = async (
  { localId, uid }: { localId?: string | null; uid?: string | null },
  /** The database or transaction to read; the app database by default. */
  db: ReturnType<typeof BaseDb.getAppDb> = BaseDb.getAppDb(),
): Promise<FoundSeedRow | undefined> => {
  if (!db) return undefined
  if (localId) {
    const [row] = await db.select().from(seeds).where(eq(seeds.localId, localId)).limit(1)
    if (row?.localId) return row as FoundSeedRow
  }
  if (!uid || uid === ZERO_BYTES32) return undefined
  const row = (await findSeedRowsByUid([uid], db)).get(uid)
  return row?.localId ? (row as FoundSeedRow) : undefined
}

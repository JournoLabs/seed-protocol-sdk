import { BaseDb } from '@/db/Db/BaseDb'
import { seeds } from '@/seedSchema'
import { eq, or } from 'drizzle-orm'

type SeedRow = { publisher: string | null; attestationRaw: string | null }

function getAttesterFromRow(row: SeedRow): string | null {
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
 * Returns the attester address for a seed (from seeds.publisher or attestationRaw.attester).
 * Used when revoking attestations to determine which account must perform the revoke.
 *
 * @param seedLocalId - Optional seed local ID
 * @param seedUid - Optional seed UID (attestation ID)
 * @returns The attester address, or null if not found or no attester
 */
export async function getAttesterForSeed(params: {
  seedLocalId?: string
  seedUid?: string
}): Promise<string | null> {
  const { seedLocalId, seedUid } = params

  const appDb = BaseDb.getAppDb()
  if (!appDb) return null

  const conditions: ReturnType<typeof eq>[] = []
  if (seedLocalId) conditions.push(eq(seeds.localId, seedLocalId))
  if (seedUid) conditions.push(eq(seeds.uid, seedUid))
  if (conditions.length === 0) return null

  const seedRows = await appDb
    .select({
      publisher: seeds.publisher,
      attestationRaw: seeds.attestationRaw,
    })
    .from(seeds)
    .where(conditions.length === 1 ? conditions[0] : (or(...conditions) as any))
    .limit(1)

  if (!seedRows || seedRows.length === 0) return null
  return getAttesterFromRow(seedRows[0])
}

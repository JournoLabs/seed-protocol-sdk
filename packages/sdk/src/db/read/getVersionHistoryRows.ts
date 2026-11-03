import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'

export type VersionHistoryRow = {
  uid: string | null
  /** Milliseconds; null until the Version is attested. */
  attestationCreatedAt: number | null
  /** Unix seconds; null unless the Version was revoked. */
  revokedAt: number | null
}

/** Every Version row of the seed with local id `seedLocalId`, in no particular order. */
export async function getVersionHistoryRows(seedLocalId: string): Promise<VersionHistoryRow[]> {
  return (await BaseDb.getAppDb()
    .select({ uid: versions.uid, attestationCreatedAt: versions.attestationCreatedAt, revokedAt: versions.revokedAt })
    .from(versions)
    .where(eq(versions.seedLocalId, seedLocalId))) as VersionHistoryRow[]
}

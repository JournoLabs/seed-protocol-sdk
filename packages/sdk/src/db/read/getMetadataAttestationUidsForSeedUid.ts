import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { and, eq, isNotNull, ne } from 'drizzle-orm'

/**
 * Returns attestation UIDs (metadata.uid) for all metadata records belonging to a seed.
 * Used when revoking attestations - metadata attestations must be revoked.
 */
export const getMetadataAttestationUidsForSeedUid = async (
  seedUid: string,
): Promise<{ uid: string; schemaUid: string }[]> => {
  if (!seedUid) return []

  const appDb = BaseDb.getAppDb()
  const rows = await appDb
    .select({ uid: metadata.uid, schemaUid: metadata.schemaUid })
    .from(metadata)
    .where(
      and(
        eq(metadata.seedUid, seedUid),
        isNotNull(metadata.uid),
        ne(metadata.uid, ''),
        ne(metadata.uid, 'NULL'),
        ne(metadata.uid, '0x' + '0'.repeat(64)),
      ),
    )

  type Row = (typeof rows)[number]
  return rows
    .filter((r: Row) => r.uid != null && r.schemaUid != null)
    .map((r: Row) => ({ uid: r.uid!, schemaUid: r.schemaUid! }))
}

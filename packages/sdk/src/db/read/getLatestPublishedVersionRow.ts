import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'
import { isValidEasAttestationUid } from '@seedprotocol/eas'
import { versionNotRevoked } from '@/db/read/subqueries/liveVersion'
import { latestVersionOrder } from '@/db/read/subqueries/latestVersion'

export type PublishedVersionRow = {
  uid: string
  localId: string | null
  attestationCreatedAt: number | null
}

/**
 * Latest version row for the seed (by `LATEST_VERSION_ORDER_SQL`) whose uid is a real EAS
 * attestation id.
 * Skips legacy 'NULL' / ZERO_BYTES32 placeholders, non-bytes32 strings, and revoked versions
 * (`revoked_at` set): after a full unpublish the seed has no published version.
 */
export async function getLatestPublishedVersionRow(
  seedLocalId: string,
): Promise<PublishedVersionRow | null> {
  const appDb = BaseDb.getAppDb()
  if (!appDb || !seedLocalId) return null

  const vRows = await appDb
    .select({
      localId: versions.localId,
      uid: versions.uid,
      attestationCreatedAt: versions.attestationCreatedAt,
    })
    .from(versions)
    .where(and(eq(versions.seedLocalId, seedLocalId), versionNotRevoked()))
    .orderBy(latestVersionOrder())

  for (const vr of vRows) {
    if (vr.uid && isValidEasAttestationUid(vr.uid)) {
      return {
        uid: vr.uid,
        localId: vr.localId ?? null,
        attestationCreatedAt: vr.attestationCreatedAt ?? null,
      }
    }
  }
  return null
}

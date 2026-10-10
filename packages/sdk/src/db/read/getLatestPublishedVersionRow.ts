import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { and, desc, eq } from 'drizzle-orm'
import { isValidEasAttestationUid } from '@/helpers/easUid'
import { versionNotRevoked } from '@/db/read/subqueries/liveVersion'

export type PublishedVersionRow = {
  uid: string
  localId: string | null
  attestationCreatedAt: number | null
}

/**
 * Latest version row for the seed (by createdAt) whose uid is a real EAS attestation id.
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
    .orderBy(desc(versions.createdAt), desc(versions.localId))

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

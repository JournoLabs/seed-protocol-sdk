import { BaseDb } from '@/db/Db/BaseDb'
import { versions } from '@/seedSchema'
import { desc, eq } from 'drizzle-orm'
import { isValidEasAttestationUid } from '@/helpers/easUid'

export type PublishedVersionRow = {
  uid: string
  localId: string | null
  attestationCreatedAt: number | null
}

/**
 * Latest version row for the seed (by createdAt) whose uid is a real EAS attestation id.
 * Skips legacy 'NULL' / ZERO_BYTES32 placeholders and non-bytes32 strings.
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
    .where(eq(versions.seedLocalId, seedLocalId))
    .orderBy(desc(versions.createdAt))

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

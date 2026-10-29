import { BaseDb } from '@/db/Db/BaseDb'
import { updateVersionUid, type UpdateVersionUidProps } from '@/db/write/updateVersionUid'
import {
  applyPropertyAttestationUidsFromPublish,
  type ApplyPropertyAttestationUidsParams,
} from '@/db/write/applyPropertyAttestationUidsFromPublish'

/**
 * Records what one publish request attested in one transaction: the Version attestation it
 * created (updateVersionUid), then its property attestation uids
 * (applyPropertyAttestationUidsFromPublish). A reader, such as getPublishPendingDiff on a change
 * feed dispatch, never sees the version published while its properties still have no uid.
 */
export async function recordPublishRequest({
  version,
  properties,
}: {
  version?: UpdateVersionUidProps
  properties?: ApplyPropertyAttestationUidsParams
}): Promise<void> {
  if (!version && !properties?.pairs.length) return
  if (!BaseDb.getAppDb()) return
  await BaseDb.transaction(async (tx) => {
    if (version) await updateVersionUid(version, { db: tx })
    if (properties?.pairs.length) await applyPropertyAttestationUidsFromPublish(properties, { db: tx })
  })
}

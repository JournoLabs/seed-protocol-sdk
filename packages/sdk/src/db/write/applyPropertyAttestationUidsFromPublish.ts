import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, type MetadataType } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import {
  isPlaceholderUid,
  isValidEasAttestationUid,
  normalizeBytes32Hex,
} from '@/helpers/easUid'
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'

export type PropertyAttestationApplyPair = {
  schemaUid: string
  attestationUid: string
  /** When set, only consider metadata rows with this property_name (disambiguate shared schemas). */
  propertyName?: string | null
}

/**
 * After property attestations succeed, write EAS UIDs onto the latest placeholder metadata row
 * per schema (and optional property name) so getPublishPendingDiff stays aligned with on-chain state.
 */
export async function applyPropertyAttestationUidsFromPublish(params: {
  seedLocalId: string
  attestationCreatedAtMs: number | null
  pairs: PropertyAttestationApplyPair[]
  versionUid?: string | null
}): Promise<void> {
  const { seedLocalId, attestationCreatedAtMs, pairs, versionUid } = params
  const appDb = BaseDb.getAppDb()
  if (!appDb || !seedLocalId || pairs.length === 0) return

  const rows = await appDb.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
  if (rows.length === 0) return

  const working: MetadataType[] = rows.map((r: MetadataType) => ({ ...r }))
  const validVersion =
    versionUid != null && versionUid !== '' && isValidEasAttestationUid(versionUid)
      ? versionUid
      : undefined

  for (const pair of pairs) {
    const att = pair.attestationUid?.trim()
    if (!isValidEasAttestationUid(att)) continue
    const wantSchema = normalizeBytes32Hex(pair.schemaUid)
    if (!wantSchema) continue

    const candidates = working
      .filter((r: MetadataType) => {
        if (!r.schemaUid) return false
        if (normalizeBytes32Hex(r.schemaUid) !== wantSchema) return false
        if (pair.propertyName != null && pair.propertyName !== '') {
          if (r.propertyName !== pair.propertyName) return false
        }
        return true
      })
      .sort(compareMetadataRowsLatestFirst)

    const target = candidates.find((r: MetadataType) => isPlaceholderUid(r.uid))
    if (!target?.localId) continue

    await appDb
      .update(metadata)
      .set({
        uid: att!,
        ...(attestationCreatedAtMs != null && { attestationCreatedAt: attestationCreatedAtMs }),
        ...(validVersion && { versionUid: validVersion }),
        updatedAt: Date.now(),
      })
      .where(eq(metadata.localId, target.localId))

    const i = working.findIndex((r: MetadataType) => r.localId === target.localId)
    if (i >= 0) {
      working[i] = {
        ...working[i]!,
        uid: att!,
        attestationCreatedAt: attestationCreatedAtMs ?? working[i]!.attestationCreatedAt,
        ...(validVersion && { versionUid: validVersion }),
      }
    }
  }
}

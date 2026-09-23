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
  /** When set, match the latest placeholder with this property_name (even if schemaUid is empty). */
  propertyName?: string | null
}

/**
 * After property attestations succeed, write EAS UIDs onto the latest placeholder metadata row
 * so getPublishPendingDiff stays aligned with on-chain state.
 * When pair.propertyName is set, match that property even if the row has no schemaUid;
 * if the row has a schemaUid it must still match. Pair-only schema match remains for unnamed pairs.
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

    const pairName =
      pair.propertyName != null && pair.propertyName !== '' ? pair.propertyName : undefined

    const candidates = working
      .filter((r: MetadataType) => {
        if (pairName) {
          if (r.propertyName !== pairName) return false
          if (r.schemaUid) {
            return normalizeBytes32Hex(r.schemaUid) === wantSchema
          }
          return true
        }
        if (!r.schemaUid) return false
        return normalizeBytes32Hex(r.schemaUid) === wantSchema
      })
      .sort(compareMetadataRowsLatestFirst)

    const target = candidates.find((r: MetadataType) => isPlaceholderUid(r.uid))
    if (!target?.localId) continue

    const writeSchemaUid = !normalizeBytes32Hex(target.schemaUid)

    await appDb
      .update(metadata)
      .set({
        uid: att!,
        ...(writeSchemaUid && { schemaUid: wantSchema }),
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
        ...(writeSchemaUid && { schemaUid: wantSchema }),
        attestationCreatedAt: attestationCreatedAtMs ?? working[i]!.attestationCreatedAt,
        ...(validVersion && { versionUid: validVersion }),
      }
    }
  }
}

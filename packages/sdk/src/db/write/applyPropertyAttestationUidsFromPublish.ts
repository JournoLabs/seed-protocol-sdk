import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions, type MetadataType } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'
import { generateId } from '@/helpers'
import { isVersionRevoked } from '@/db/read/subqueries/liveVersion'
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
 *
 * A full-snapshot publish (`new_version`, or a republish after unpublish) also attests properties
 * whose rows are already attested (on an older version, or the revoked seed's). With no placeholder
 * to take the uid, the attestation is recorded as a new row for the published version: a copy of
 * the property's latest row with the new uid, so readers show the published version without a
 * sync. Rows keep or get the published version's local id when `versionUid` has a version row.
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

  let versionLocalId: string | undefined
  let liveSeedUid: string | null = null
  if (validVersion) {
    const [versionRow] = await appDb
      .select({ localId: versions.localId, seedUid: versions.seedUid })
      .from(versions)
      .where(and(eq(versions.seedLocalId, seedLocalId), eq(versions.uid, validVersion)))
      .limit(1)
    versionLocalId = versionRow?.localId ?? undefined
    const [seedRow] = await appDb
      .select({ uid: seeds.uid, revokedAt: seeds.revokedAt })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
      .limit(1)
    // A republish records its new seed uid after this; updateSeedUid fills it in then.
    liveSeedUid =
      versionRow?.seedUid ??
      (isValidEasAttestationUid(seedRow?.uid) && !isVersionRevoked(seedRow?.revokedAt)
        ? seedRow!.uid
        : null)
  }

  for (const pair of pairs) {
    const att = pair.attestationUid?.trim()
    if (!isValidEasAttestationUid(att)) continue
    const wantSchema = normalizeBytes32Hex(pair.schemaUid)
    if (!wantSchema) continue

    const pairName =
      pair.propertyName != null && pair.propertyName !== '' ? pair.propertyName : undefined

    const candidates = working
      .filter((r: MetadataType) => {
        // Rows sync derived for ItemStorage properties aren't placeholders for an attestation.
        if (r.derivedFromUid != null) return false
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
    if (!target?.localId) {
      // Full snapshot: the property's rows are all attested. Record this attestation as a new row
      // for the published version (unless it is already recorded, e.g. a replayed receipt).
      const source = candidates[0]
      if (!source || !validVersion) continue
      if (working.some((r: MetadataType) => r.uid?.toLowerCase() === att!.toLowerCase())) continue
      const now = Date.now()
      const row: MetadataType = {
        ...source,
        localId: generateId(),
        uid: att!,
        schemaUid: normalizeBytes32Hex(source.schemaUid) ? source.schemaUid : wantSchema,
        seedUid: liveSeedUid,
        versionUid: validVersion,
        versionLocalId: versionLocalId ?? source.versionLocalId,
        attestationCreatedAt: attestationCreatedAtMs ?? now,
        attestationRaw: null,
        revokedAt: null,
        derivedFromUid: null,
        createdAt: now,
        updatedAt: now,
      }
      await appDb.insert(metadata).values(row)
      working.push(row)
      continue
    }

    const writeSchemaUid = !normalizeBytes32Hex(target.schemaUid)

    await appDb
      .update(metadata)
      .set({
        uid: att!,
        ...(writeSchemaUid && { schemaUid: wantSchema }),
        ...(attestationCreatedAtMs != null && { attestationCreatedAt: attestationCreatedAtMs }),
        ...(validVersion && { versionUid: validVersion }),
        ...(versionLocalId && { versionLocalId }),
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
        ...(versionLocalId && { versionLocalId }),
      }
    }
  }
}

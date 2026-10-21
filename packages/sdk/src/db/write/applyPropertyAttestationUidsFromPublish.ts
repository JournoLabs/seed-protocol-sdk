import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties, seeds, versions, type MetadataType } from '@/seedSchema'
import { and, eq, inArray } from 'drizzle-orm'
import { generateId } from '@/helpers'
import { normalizeDataType } from '@/helpers/property/index'
import { listRelationEasPropertyName } from '@/helpers/metadataPropertyNames'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { isVersionRevoked } from '@/db/read/subqueries/liveVersion'
import {
  isPlaceholderUid,
  isValidEasAttestationUid,
  normalizeBytes32Hex,
} from '@seedprotocol/eas'
import { compareMetadataRowsLatestFirst } from '@/helpers/compareMetadataRowsLatestFirst'

export type PropertyAttestationApplyPair = {
  schemaUid: string
  attestationUid: string
  /** When set, match the latest placeholder with this property_name (even if schemaUid is empty). */
  propertyName?: string | null
  /**
   * The metadata row whose value was attested (the payload's `_metadataLocalId`). When the seed has
   * that row, it is the one recorded: no search by name, which could pick a newer row holding a
   * value the chain doesn't have.
   */
  metadataLocalId?: string | null
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
 *
 * Relations and lists of relations are recorded as attested, the way an EAS sync of the
 * attestation stores them:
 * - a List of Relation row lives under its storage name (`authors` → `authorIdentityIds`) while a
 *   publish names the attestation by schema key; either name matches.
 * - a value naming seeds by local id gets the seed uids the attestation encodes: the uid (Relation),
 *   a JSON array of uids in slot order (List). Each uid comes from `resolvedSeedUids` (seeds this
 *   publish created, not recorded on their seed rows yet), else the seed's recorded live uid.
 */
export async function applyPropertyAttestationUidsFromPublish(params: {
  seedLocalId: string
  attestationCreatedAtMs: number | null
  pairs: PropertyAttestationApplyPair[]
  versionUid?: string | null
  /** Seed uid, by local id, of the seeds this publish has created so far. */
  resolvedSeedUids?: Record<string, string> | null
}): Promise<void> {
  const { seedLocalId, attestationCreatedAtMs, pairs, versionUid, resolvedSeedUids } = params
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

  const refDefs = await loadRefPropertyDefs(appDb, seedLocalId, rows)
  const attestedRefValue = async (
    row: MetadataType,
    def: RefPropertyDef | undefined,
  ): Promise<string | undefined> => {
    const d = def ?? (row.propertyName ? refDefs.get(row.propertyName) : undefined)
    if (!d || row.propertyValue == null) return undefined
    return toAttestedRefValue(appDb, row.propertyValue, d.kind, resolvedSeedUids ?? {})
  }

  for (const pair of pairs) {
    const att = pair.attestationUid?.trim()
    if (!isValidEasAttestationUid(att)) continue
    const wantSchema = normalizeBytes32Hex(pair.schemaUid)
    if (!wantSchema) continue

    const pairName =
      pair.propertyName != null && pair.propertyName !== '' ? pair.propertyName : undefined
    const pairDef = pairName ? refDefs.get(pairName) : undefined
    const pairNames = new Set<string>(
      pairName ? [pairName, ...(pairDef ? [pairDef.schemaKey, pairDef.storageName] : [])] : [],
    )

    const attestedRow = pair.metadataLocalId
      ? working.find((r: MetadataType) => r.localId === pair.metadataLocalId)
      : undefined
    const candidates = attestedRow
      ? [attestedRow]
      : working
        .filter((r: MetadataType) => {
          // Rows sync derived for ItemStorage properties aren't placeholders for an attestation.
          if (r.derivedFromUid != null) return false
          if (pairName) {
            if (!r.propertyName || !pairNames.has(r.propertyName)) return false
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
      const attestedValue = await attestedRefValue(source, pairDef)
      const row: MetadataType = {
        ...source,
        ...(attestedValue !== undefined && { propertyValue: attestedValue }),
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
// Stamped here: the spread copies the source row's times.
        createdAt: now,
        updatedAt: now,
      }
      await appDb.insert(metadata).values(row)
      working.push(row)
      continue
    }

    const writeSchemaUid = !normalizeBytes32Hex(target.schemaUid)
    const attestedValue = await attestedRefValue(target, pairDef)

    await appDb
      .update(metadata)
      .set({
        uid: att!,
        ...(attestedValue !== undefined && { propertyValue: attestedValue }),
        ...(writeSchemaUid && { schemaUid: wantSchema }),
        ...(attestationCreatedAtMs != null && { attestationCreatedAt: attestationCreatedAtMs }),
        ...(validVersion && { versionUid: validVersion }),
        ...(versionLocalId && { versionLocalId }),
      })
      .where(eq(metadata.localId, target.localId))

    const i = working.findIndex((r: MetadataType) => r.localId === target.localId)
    if (i >= 0) {
      working[i] = {
        ...working[i]!,
        uid: att!,
        ...(attestedValue !== undefined && { propertyValue: attestedValue }),
        ...(writeSchemaUid && { schemaUid: wantSchema }),
        attestationCreatedAt: attestationCreatedAtMs ?? working[i]!.attestationCreatedAt,
        ...(validVersion && { versionUid: validVersion }),
        ...(versionLocalId && { versionLocalId }),
      }
    }
  }
}

type AppDb = NonNullable<ReturnType<typeof BaseDb.getAppDb>>

type RefPropertyDef = { kind: 'relation' | 'list'; schemaKey: string; storageName: string }

/**
 * The seed's Relation and List-of-Relation properties, keyed by schema key and (lists) by storage
 * name. The model comes from the seed's model_file_id, else a metadata row's property_id; an
 * unknown model gives no definitions (rows then match by the pair's name alone, values unchanged).
 */
async function loadRefPropertyDefs(
  appDb: AppDb,
  seedLocalId: string,
  rows: MetadataType[],
): Promise<Map<string, RefPropertyDef>> {
  const out = new Map<string, RefPropertyDef>()
  try {
    let modelId: number | undefined
    const [seedRow] = await appDb
      .select({ modelFileId: seeds.modelFileId })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
      .limit(1)
    if (seedRow?.modelFileId) {
      const [m] = await appDb
        .select({ id: models.id })
        .from(models)
        .where(eq(models.schemaFileId, seedRow.modelFileId))
        .limit(1)
      modelId = m?.id
    }
    const propertyId = rows.find((r) => r.propertyId != null)?.propertyId
    if (modelId == null && propertyId != null) {
      const [p] = await appDb
        .select({ modelId: properties.modelId })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .limit(1)
      modelId = p?.modelId ?? undefined
    }
    if (modelId == null) return out

    const props: Array<{
      name: string
      dataType: string
      refModelId: number | null
      refValueType: string | null
    }> = await appDb
      .select({
        name: properties.name,
        dataType: properties.dataType,
        refModelId: properties.refModelId,
        refValueType: properties.refValueType,
      })
      .from(properties)
      .where(eq(properties.modelId, modelId))
    const refIds = [...new Set(props.map((p) => p.refModelId).filter((id): id is number => id != null))]
    const refNames = new Map<number, string>()
    if (refIds.length) {
      const refs: Array<{ id: number; name: string }> = await appDb
        .select({ id: models.id, name: models.name })
        .from(models)
        .where(inArray(models.id, refIds))
      for (const r of refs) refNames.set(r.id, r.name)
    }
    for (const p of props) {
      const dataType = normalizeDataType(p.dataType)
      if (dataType === 'Relation') {
        out.set(p.name, { kind: 'relation', schemaKey: p.name, storageName: p.name })
        continue
      }
      if (dataType !== 'List' || normalizeDataType(p.refValueType ?? undefined) !== 'Relation') continue
      const ref = p.refModelId != null ? refNames.get(p.refModelId) : undefined
      const storageName = ref ? listRelationEasPropertyName(p.name, { dataType: 'List', ref }) : undefined
      if (!storageName) continue
      const def: RefPropertyDef = { kind: 'list', schemaKey: p.name, storageName }
      out.set(p.name, def)
      out.set(storageName, def)
    }
  } catch {
    // Unknown model: match by the pair's name alone.
  }
  return out
}

const isUid = (v: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(v)

/**
 * `raw` (a Relation value, or a List value as stored) with every seed named by local id replaced by
 * its uid: from `resolvedSeedUids`, else the seed's recorded live uid. Undefined when nothing
 * changes, or when a seed has no uid (then the value is not what was attested; left as it is).
 */
async function toAttestedRefValue(
  appDb: AppDb,
  raw: string,
  kind: RefPropertyDef['kind'],
  resolvedSeedUids: Record<string, string>,
): Promise<string | undefined> {
  const refs = kind === 'list' ? parseListPropertyValueFromStorage(raw) : [raw.trim()]
  if (refs.length === 0 || refs.some((r) => !r)) return undefined
  const unknown = [...new Set(refs.filter((r) => !isUid(r) && !resolvedSeedUids[r]))]
  const recorded = new Map<string, string>()
  if (unknown.length) {
    const seedRows: Array<{ localId: string | null; uid: string | null; revokedAt: number | null }> =
      await appDb
        .select({ localId: seeds.localId, uid: seeds.uid, revokedAt: seeds.revokedAt })
        .from(seeds)
        .where(inArray(seeds.localId, unknown))
    for (const s of seedRows) {
      if (s.localId && isValidEasAttestationUid(s.uid) && !isVersionRevoked(s.revokedAt)) {
        recorded.set(s.localId, s.uid!)
      }
    }
  }
  const out: string[] = []
  for (const ref of refs) {
    const uid = isUid(ref) ? ref : (resolvedSeedUids[ref] ?? recorded.get(ref))
    if (!uid) return undefined
    out.push(uid)
  }
  const value = kind === 'list' ? JSON.stringify(out) : out[0]!
  return value === raw ? undefined : value
}

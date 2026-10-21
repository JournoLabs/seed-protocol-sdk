import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties, seeds, versions, type MetadataType } from '@/seedSchema'
import { and, eq, inArray } from 'drizzle-orm'
import {
  findMetadataPropertyByName,
  metadataPropertyNameForms,
  readModelMetadataProperties,
  type MetadataProperty,
} from '@/db/read/metadataProperty'
import { generateId } from '@/helpers'
import { normalizeDataType } from '@/helpers/property/index'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
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
 * - a pair names its property by schema key or a stored name; the property's rows are the ones
 *   linked to it by property_id, and rows with none match by any name it is stored under
 *   (`authors`, `authorIdentityIds`; `author`, `authorId`).
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

  const props = await loadSeedProperties(appDb, seedLocalId, rows)
  const propertyOfRow = (row: MetadataType): MetadataProperty | undefined =>
    (row.propertyId != null ? props.find((p) => p.id === row.propertyId) : undefined) ??
    (row.propertyName ? findMetadataPropertyByName(props, row.propertyName) : undefined)
  const attestedRefValue = async (
    row: MetadataType,
    property: MetadataProperty | undefined,
  ): Promise<string | undefined> => {
    const kind = refKind(property ?? propertyOfRow(row))
    if (!kind || row.propertyValue == null) return undefined
    return toAttestedRefValue(appDb, row.propertyValue, kind, resolvedSeedUids ?? {})
  }

  for (const pair of pairs) {
    const att = pair.attestationUid?.trim()
    if (!isValidEasAttestationUid(att)) continue
    const wantSchema = normalizeBytes32Hex(pair.schemaUid)
    if (!wantSchema) continue

    const pairName =
      pair.propertyName != null && pair.propertyName !== '' ? pair.propertyName : undefined
    // The pair's property: rows linked to it by property_id (decision D4) are its rows, whatever
    // name they are stored under; rows with no property_id match by any of its stored names.
    const pairProperty = pairName ? findMetadataPropertyByName(props, pairName) : undefined
    const pairNames = new Set<string>(
      pairName ? [pairName, ...(pairProperty ? metadataPropertyNameForms(pairProperty) : [])] : [],
    )
    const isPairRow = (r: MetadataType): boolean =>
      pairProperty && r.propertyId != null
        ? r.propertyId === pairProperty.id
        : !!r.propertyName && pairNames.has(r.propertyName)
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
            if (!isPairRow(r)) return false
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
      const attestedValue = await attestedRefValue(source, pairProperty)
      const row: MetadataType = {
        ...source,
        ...(attestedValue !== undefined && { propertyValue: attestedValue }),
        localId: generateId(),
        propertyId: source.propertyId ?? propertyOfRow(source)?.id ?? null,
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
    const attestedValue = await attestedRefValue(target, pairProperty)

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

type RefKind = 'relation' | 'list'

/** How a property's value names seeds: one seed (Relation) or a JSON list of them (List of Relation). */
function refKind(property: MetadataProperty | undefined): RefKind | undefined {
  if (!property) return undefined
  const dataType = normalizeDataType(property.dataType)
  if (dataType === 'Relation') return 'relation'
  if (dataType === 'List' && normalizeDataType(property.refValueType ?? undefined) === 'Relation' && property.ref) {
    return 'list'
  }
  return undefined
}

/**
 * The seed's model's properties. The model comes from the seed's model_file_id, else a metadata
 * row's property_id; an unknown model gives none (rows then match by the pair's name alone,
 * values unchanged).
 */
async function loadSeedProperties(
  appDb: AppDb,
  seedLocalId: string,
  rows: MetadataType[],
): Promise<MetadataProperty[]> {
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
    if (modelId == null) return []
    return await readModelMetadataProperties(appDb, modelId)
  } catch {
    // Unknown model: match by the pair's name alone.
    return []
  }
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
  kind: RefKind,
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

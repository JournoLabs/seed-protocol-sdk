import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties, seeds, versions, type MetadataType } from '@/seedSchema'
import { and, eq, inArray } from 'drizzle-orm'
import {
  findMetadataPropertyByName,
  readModelMetadataProperties,
  type MetadataProperty,
} from '@/db/read/metadataProperty'
import { generateId } from '@/helpers'
import { normalizePublisher } from '@/helpers/addresses'
import { normalizeDataType } from '@/helpers/property/index'
import { parseListPropertyValueFromStorage } from '@/helpers/listPropertyValueFromStorage'
import { isVersionRevoked } from '@/db/read/subqueries/liveVersion'
import {
  isPlaceholderUid,
  isValidEasAttestationUid,
  normalizeBytes32Hex,
} from '@seedprotocol/eas'

export type PropertyAttestationApplyPair = {
  schemaUid: string
  attestationUid: string
  /** The property's schema key (the payload's `_propertyName`). */
  propertyName?: string | null
  /** The metadata row whose value was attested (the payload's `_metadataLocalId`): the row recorded. */
  metadataLocalId?: string | null
  /** A value the attestation carries that the row doesn't hold yet (the payload's `_attestedValue`). */
  value?: string | null
}

export type ApplyPropertyAttestationUidsParams = {
  seedLocalId: string
  attestationCreatedAtMs: number | null
  pairs: PropertyAttestationApplyPair[]
  versionUid?: string | null
  /** Seed uid, by local id, of the seeds this publish has created so far. */
  resolvedSeedUids?: Record<string, string> | null
  /** The address that attested. */
  publisher?: string | null
}

/**
 * After property attestations succeed, records each one on the metadata row whose value it
 * attested (`metadataLocalId`, which the payload read), so getPublishPendingDiff and later
 * publishes stay aligned with on-chain state. No row is searched for by name: a newer row holds a
 * value the chain doesn't have (audit 1.1, G18-4).
 *
 * - A placeholder row (no uid yet) takes the uid, the version, and the schema uid when it has none.
 * - An attested row (a full-snapshot publish: `new_version`, or a republish after unpublish,
 *   attests properties attested before) stays as it is, and the attestation is recorded as a new
 *   row for the published version: a copy with the new uid, so readers show the published version
 *   without a sync.
 * - A pair with no row (a property with no row yet, e.g. a storage transaction slot) gets a new
 *   row when it names its property and carries its value.
 * Rows keep or get the published version's local id when `versionUid` has a version row. Every row
 * recorded takes `publisher`, the address that attested, in place of the one the draft was stamped
 * with.
 *
 * Relations and lists of relations are recorded as attested, the way an EAS sync of the
 * attestation stores them: a value naming seeds by local id gets the seed uids the attestation
 * encodes, the uid (Relation) or a JSON array of uids in slot order (List). Each uid comes from
 * `resolvedSeedUids` (seeds this publish created, not recorded on their seed rows yet), else the
 * seed's recorded live uid.
 *
 * With `db` (a transaction), it reads and writes there.
 */
export async function applyPropertyAttestationUidsFromPublish(
  params: ApplyPropertyAttestationUidsParams,
  { db }: { db?: AppDb } = {},
): Promise<void> {
  const { seedLocalId, attestationCreatedAtMs, pairs, versionUid, resolvedSeedUids } = params
  const publisher = normalizePublisher(params.publisher ?? undefined)
  const appDb = db ?? BaseDb.getAppDb()
  if (!appDb || !seedLocalId || pairs.length === 0) return

  const rows = await appDb.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
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
  const attestedRefValue = async (row: Pick<MetadataType, 'propertyValue'>, property: MetadataProperty | undefined) => {
    const kind = refKind(property)
    if (!kind || row.propertyValue == null) return undefined
    return toAttestedRefValue(appDb, row.propertyValue, kind, resolvedSeedUids ?? {})
  }

  for (const pair of pairs) {
    const att = pair.attestationUid?.trim()
    if (!isValidEasAttestationUid(att)) continue
    const wantSchema = normalizeBytes32Hex(pair.schemaUid)
    if (!wantSchema) continue
    // Already recorded (a replayed receipt)
    if (working.some((r: MetadataType) => r.uid?.toLowerCase() === att!.toLowerCase())) continue

    const target = pair.metadataLocalId ? working.find((r: MetadataType) => r.localId === pair.metadataLocalId) : undefined
    const property = target ? propertyOfRow(target) : pair.propertyName ? findMetadataPropertyByName(props, pair.propertyName) : undefined
    const value = pair.value ?? target?.propertyValue ?? null
    const attestedValue = await attestedRefValue({ propertyValue: value }, property)
    const recordedValue = attestedValue ?? value

    if (target?.localId && isPlaceholderUid(target.uid)) {
      const update = {
        uid: att!,
        ...(recordedValue !== target.propertyValue && { propertyValue: recordedValue }),
        ...(!normalizeBytes32Hex(target.schemaUid) && { schemaUid: wantSchema }),
        ...(attestationCreatedAtMs != null && { attestationCreatedAt: attestationCreatedAtMs }),
        ...(validVersion && { versionUid: validVersion }),
        ...(versionLocalId && { versionLocalId }),
        ...(publisher && { publisher }),
      }
      await appDb.update(metadata).set(update).where(eq(metadata.localId, target.localId))
      Object.assign(target, update)
      continue
    }

    // An attested row (full snapshot), or none: record the attestation as a new row for the
    // published version.
    if (!validVersion) continue
    if (!target && (!pair.propertyName || pair.value == null)) continue
    const now = Date.now()
    const row: MetadataType = {
      ...(target ?? {
        propertyName: property?.storageName ?? pair.propertyName!,
        seedLocalId,
        modelType: null,
        easDataType: null,
        refValueType: null,
        refModelUid: null,
        refSeedType: null,
        refResolvedValue: null,
        refResolvedDisplayValue: null,
        localStorageDir: null,
        contentHash: null,
        publisher: null,
        retract: null,
      }),
      propertyValue: recordedValue,
      localId: generateId(),
      propertyId: target?.propertyId ?? property?.id ?? null,
      uid: att!,
      schemaUid: normalizeBytes32Hex(target?.schemaUid) ? target!.schemaUid : wantSchema,
      seedUid: liveSeedUid,
      versionUid: validVersion,
      versionLocalId: versionLocalId ?? target?.versionLocalId ?? null,
      attestationCreatedAt: attestationCreatedAtMs ?? now,
      attestationRaw: null,
      revokedAt: null,
      derivedFromUid: null,
      ...(publisher && { publisher }),
      // Stamped here: the spread copies the source row's times.
      createdAt: now,
      updatedAt: now,
    } as MetadataType
    await appDb.insert(metadata).values(row)
    working.push(row)
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

import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { ZERO_BYTES32 } from '@/helpers/constants'
import { isVersionRevoked } from './subqueries/liveVersion'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'
import type { IItem } from '@/interfaces'

export type RelatedSeedRow = {
  seedLocalId: string
  /** The seed's current uid (null while it was never published). */
  seedUid: string | null
  revokedAt: number | null
  type: string | null
}

const selectSeed = {
  seedLocalId: seeds.localId,
  seedUid: seeds.uid,
  revokedAt: seeds.revokedAt,
  type: seeds.type,
}

/**
 * The local seed row a relation/list/image ref points at, by local id or uid. A uid that is no
 * seed's current uid can be the old uid of a seed that was unpublished and published again (a new
 * seed attestation, same local seed): its old version rows still record it, so it resolves to that
 * seed. Null when nothing local matches (e.g. a published uid with no local copy).
 */
export const findRelatedSeedRow = async ({
  seedLocalId,
  seedUid,
}: {
  seedLocalId?: string
  seedUid?: string
}): Promise<RelatedSeedRow | null> => {
  const appDb = BaseDb.getAppDb()
  if (!appDb) return null
  if (seedLocalId) {
    const [row] = await appDb.select(selectSeed).from(seeds).where(eq(seeds.localId, seedLocalId)).limit(1)
    if (row?.seedLocalId) return row as RelatedSeedRow
  }
  if (!seedUid || seedUid === ZERO_BYTES32) return null
  const [byUid] = await appDb.select(selectSeed).from(seeds).where(eq(seeds.uid, seedUid)).limit(1)
  if (byUid?.seedLocalId) return byUid as RelatedSeedRow
  const [version] = await appDb
    .select({ seedLocalId: versions.seedLocalId })
    .from(versions)
    .where(and(eq(versions.seedUid, seedUid), isNotNull(versions.seedLocalId)))
    .limit(1)
  if (!version?.seedLocalId) return null
  const [republished] = await appDb
    .select(selectSeed)
    .from(seeds)
    .where(eq(seeds.localId, version.seedLocalId))
    .limit(1)
  return republished?.seedLocalId ? (republished as RelatedSeedRow) : null
}

/** The seed is attested and its attestation is live. */
export const isLivePublishedSeed = (row: RelatedSeedRow | null): row is RelatedSeedRow & { seedUid: string } =>
  !!row?.seedUid && row.seedUid !== ZERO_BYTES32 && !isVersionRevoked(row.revokedAt)

/** The seed was attested and that attestation was revoked (unpublished). */
export const isUnpublishedSeed = (row: RelatedSeedRow | null): row is RelatedSeedRow & { seedUid: string } =>
  !!row?.seedUid && row.seedUid !== ZERO_BYTES32 && isVersionRevoked(row.revokedAt)

/** Model a relation/list/image property points at, from its definition. */
export function relatedModelNameFromDef(propertyDef: unknown): string | undefined {
  const def = propertyDef as { dataType?: string; ref?: string; refModelName?: string } | undefined
  if (!def) return undefined
  const dataType = normalizeDataType(def.dataType)
  if (dataType === ModelPropertyDataTypes.Image) return 'Image'
  if (dataType === ModelPropertyDataTypes.File) return 'File'
  if (dataType === ModelPropertyDataTypes.Html) return 'Html'
  return def.ref ?? def.refModelName
}

/**
 * Name of the item's Html property whose value is the Html seed `htmlSeedLocalId`: the property
 * that refers to the images embedded in that Html (htmlEmbeddedImageCoPublish rows).
 */
export function htmlPropertyNameForHtmlSeed(item: IItem<any>, htmlSeedLocalId: string): string {
  const want = htmlSeedLocalId.trim()
  for (const p of item.properties ?? []) {
    if (normalizeDataType(p.propertyDef?.dataType) !== ModelPropertyDataTypes.Html) continue
    const snap = p.getService().getSnapshot()
    const value = 'context' in snap ? (snap.context as { propertyValue?: unknown }).propertyValue : undefined
    if (typeof value === 'string' && value.trim() === want) return p.propertyName
  }
  return 'html'
}

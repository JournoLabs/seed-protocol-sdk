import { findSeedRow } from './findSeedRow'
import { ZERO_BYTES32 } from '@/helpers/constants'
import { isVersionRevoked } from './subqueries/liveVersion'
import { ModelPropertyDataTypes, normalizeDataType } from '@/helpers/property'

export type RelatedSeedRow = {
  seedLocalId: string
  /** The seed's current uid (null while it was never published). */
  seedUid: string | null
  revokedAt: number | null
  type: string | null
}

/**
 * The local seed row a relation/list/image ref points at, by local id or uid. A uid resolves as
 * {@link findSeedRow} resolves it (the order EAS sync matches seeds in): the old uid of a seed
 * that was unpublished and published again resolves to that seed, through its old version rows.
 * Null when nothing local matches (e.g. a published uid with no local copy).
 */
export const findRelatedSeedRow = async ({
  seedLocalId,
  seedUid,
}: {
  seedLocalId?: string
  seedUid?: string
}): Promise<RelatedSeedRow | null> => {
  const row = await findSeedRow({ localId: seedLocalId, uid: seedUid })
  return row ? { seedLocalId: row.localId, seedUid: row.uid, revokedAt: row.revokedAt, type: row.type } : null
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

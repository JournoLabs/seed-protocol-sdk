import { and, eq, or, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, type MetadataType } from '@/seedSchema'
import { getMetadataPropertyNamesForQuery } from '@/helpers/metadataPropertyNames'
import { METADATA_LATEST_FIRST_ORDER_SQL } from '@/helpers/compareMetadataRowsLatestFirst'
import { isPublishedMetadataRow } from '@/helpers/isPublishedMetadataRow'
import { isValidEasAttestationUid } from '@/helpers/easUid'

/** An empty current value that publishing changes: it has live attestations to remove or retract. */
export type PropertyClear = {
  /** The newest row is an unpublished retraction: publish revokes `retractScope` instead of attesting. */
  retract: boolean
  /** The property's attestations on the seed that are still live, newest first. */
  live: MetadataType[]
  /**
   * What a retraction revokes: the live attestations on the Version of the newest one, and those on
   * other Versions whose value is one of theirs. That Version is the seed's current one unless the
   * property was attested only before it, or a `new_version` publish has just made a newer one.
   */
  retractScope: MetadataType[]
}

const isEmptyValue = (value: string | null | undefined): boolean => value == null || value === ''

/**
 * What publishing a property with an empty value does (ADR 0021). Undefined when there is nothing
 * to publish: the newest row holds a value, or the property has no live attestation (never
 * published, or already retracted). Rows of every name the property is stored under count.
 */
export async function getPropertyClear(params: {
  seedLocalId?: string | null
  seedUid?: string | null
  propertyName: string
  dataType?: string
  refValueType?: string
}): Promise<PropertyClear | undefined> {
  const { seedLocalId, seedUid, propertyName, dataType, refValueType } = params
  if (!seedLocalId && !seedUid) return undefined
  const appDb = BaseDb.getAppDb()
  if (!appDb) return undefined

  const names = getMetadataPropertyNamesForQuery(propertyName, dataType, refValueType)
  const seedWhere =
    seedLocalId && seedUid
      ? or(eq(metadata.seedLocalId, seedLocalId), eq(metadata.seedUid, seedUid))
      : seedLocalId
        ? eq(metadata.seedLocalId, seedLocalId)
        : eq(metadata.seedUid, seedUid!)
  const rows = (await appDb
    .select()
    .from(metadata)
    .where(and(or(...names.map((name) => eq(metadata.propertyName, name))), seedWhere))
    .orderBy(sql.raw(METADATA_LATEST_FIRST_ORDER_SQL))) as MetadataType[]

  const newest = rows[0]
  if (!newest || !isEmptyValue(newest.propertyValue)) return undefined
  const live = rows.filter((row) => isValidEasAttestationUid(row.uid) && row.revokedAt == null)
  if (live.length === 0) return undefined

  // `live` is newest first
  const onVersion = live.filter((row) => row.versionUid === live[0]!.versionUid)
  const values = new Set(onVersion.map((row) => row.propertyValue))
  const retractScope = live.filter((row) => onVersion.includes(row) || values.has(row.propertyValue))

  return { retract: !!newest.retract && !isPublishedMetadataRow(newest), live, retractScope }
}

/** The empty value of an EAS type, or undefined for `bool` and `uint256`, which have none (ADR 0021). */
export function emptyEasValue(easDataType: string | undefined): string | string[] | undefined {
  if (easDataType === 'string') return ''
  if (easDataType === 'bytes32') return `0x${'0'.repeat(64)}`
  if (easDataType === 'bytes32[]') return []
  return undefined
}

/** A retracted property and the attestations publish revokes for it. */
export type PendingRetraction = {
  propertyName: string
  attestations: { uid: string; schemaUid: string }[]
}

/**
 * The seed's retracted properties that still have attestations to revoke (ADR 0021), with the
 * attestations publish revokes for each.
 */
export async function getPendingRetractions(params: {
  seedLocalId?: string | null
  seedUid?: string | null
}): Promise<PendingRetraction[]> {
  const { seedLocalId, seedUid } = params
  if (!seedLocalId && !seedUid) return []
  const { getPublishPendingDiff } = await import('@/db/read/getPublishPendingDiff')
  const { pendingProperties } = await getPublishPendingDiff({
    seedLocalId: seedLocalId ?? undefined,
    seedUid: seedUid ?? undefined,
  })
  const retractions: PendingRetraction[] = []
  for (const { propertyName, change } of pendingProperties) {
    if (change !== 'retracted') continue
    const clear = await getPropertyClear({ seedLocalId, seedUid, propertyName })
    if (!clear?.retract) continue
    const attestations = clear.retractScope
      .filter((row) => row.uid && row.schemaUid)
      .map((row) => ({ uid: row.uid!, schemaUid: row.schemaUid! }))
    if (attestations.length > 0) retractions.push({ propertyName, attestations })
  }
  return retractions
}

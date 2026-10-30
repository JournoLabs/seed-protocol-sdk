import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import type { MetadataType } from '@/seedSchema/MetadataSchema'
import { eq, or } from 'drizzle-orm'
import type { IItem } from '@/interfaces'
import { isPublishedMetadataRow as isPublished } from '@/helpers/isPublishedMetadataRow'
import { compareMetadataRowsLatestFirst, metadataPropertyGroupKeys } from '@/helpers/compareMetadataRowsLatestFirst'
import { readMetadataPropertiesById } from '@/db/read/metadataProperty'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { getPropertyClear } from '@/db/read/getPropertyClear'
import { currentPropertyRows } from '@/db/read/currentPropertyRow'
import { propertyValuesEqual } from '@/helpers/propertyValuesEqual'

export type PublishPendingPropertyDiff = {
  propertyName: string
  currentValue: string | null
  /** Value from the most recent row that had an on-chain attestation uid, if any */
  previousPublishedValue: string | null
  /** True when the latest row for this property has no `uid` (not yet attested) */
  pending: boolean
  /**
   * `set` for a new value. `removed` for an empty value that publish attests as removed, and
   * `retracted` for one whose attestations publish revokes (ADR 0021).
   */
  change: 'set' | 'removed' | 'retracted'
}

export type GetPublishPendingDiffResult = {
  /** Properties whose latest metadata row is unpublished (no `uid`) */
  pendingProperties: PublishPendingPropertyDiff[]
  lastPublishedVersionUid: string | null
  lastVersionPublishedAt: number | null
}

function resolveSeedIds(
  arg: { seedLocalId?: string; seedUid?: string } | IItem<any>,
): { seedLocalId?: string; seedUid?: string } {
  if (arg && typeof arg === 'object' && 'seedLocalId' in arg) {
    const item = arg as IItem<any>
    return {
      seedLocalId: item.seedLocalId,
      seedUid: item.seedUid,
    }
  }
  return arg as { seedLocalId?: string; seedUid?: string }
}

/**
 * Per property: its current row (currentPropertyRows, with a pending outbox value over the stored
 * row) lacks a valid EAS attestation `uid` — local edit or missing post-publish UID backfill. Rows sync derived for
 * ItemStorage properties (`derivedFromUid` set) count as published. A value equal to the last
 * published one (propertyValuesEqual: relations by seed, lists in order) isn't listed: an edit
 * back to it leaves no draft once the outbox applies it. **Not** equivalent to draft vs onchain
 * for the whole seed; use `getSeedPublishState` for that.
 *
 * A publish records each request's version uid and property uids in one transaction, before it
 * reports success, so a read after that never sees the version published without its properties.
 */
export async function getPublishPendingDiff(
  arg: { seedLocalId?: string; seedUid?: string } | IItem<any>,
): Promise<GetPublishPendingDiffResult> {
  const { seedLocalId, seedUid } = resolveSeedIds(arg)
  const appDb = BaseDb.getAppDb()
  const empty: GetPublishPendingDiffResult = {
    pendingProperties: [],
    lastPublishedVersionUid: null,
    lastVersionPublishedAt: null,
  }
  if (!appDb || (!seedLocalId && !seedUid)) {
    return empty
  }

  const whereClause =
    seedLocalId && seedUid
      ? or(eq(metadata.seedLocalId, seedLocalId), eq(metadata.seedUid, seedUid))
      : seedLocalId
        ? eq(metadata.seedLocalId, seedLocalId)
        : eq(metadata.seedUid, seedUid!)

  // Every row, for each property's last published value; the current one is currentPropertyRows',
  // with a pending outbox value counting as an unpublished edit (ADR 0019)
  const rows = (await appDb.select().from(metadata).where(whereClause)) as MetadataType[]
  const current = await currentPropertyRows({ seedLocalId, seedUid })

  // One group per property: by property_id (decision D4), rows without one by stored name. A
  // property is reported under its storage name, the name its new rows are written under.
  const groupKey = metadataPropertyGroupKeys(rows)
  const byProp = new Map<string, MetadataType[]>()
  for (const row of rows) {
    if (!row.propertyName) continue
    const key = groupKey(row)
    const list = byProp.get(key) ?? []
    list.push(row)
    byProp.set(key, list)
  }
  for (const list of byProp.values()) {
    list.sort(compareMetadataRowsLatestFirst)
  }

  const propertiesById = await readMetadataPropertiesById(
    appDb,
    [...rows, ...current].map((row) => row.propertyId),
  )
  const pendingProperties: PublishPendingPropertyDiff[] = []
  for (const latest of current) {
    if (!latest.propertyName || isPublished(latest)) continue
    const list = byProp.get(groupKey(latest as MetadataType)) ?? []
    const prevWithUid = list.find(isPublished)
    const groupId = latest.propertyId ?? list.find((row) => row.propertyId != null)?.propertyId
    const property = groupId != null ? propertiesById.get(groupId) : undefined
    const isEmpty = latest.propertyValue == null || latest.propertyValue === ''
    // An empty value changes nothing on chain unless it has an attestation to remove or retract
    // (ADR 0021): one never published, or already retracted, isn't pending.
    if (isEmpty) {
      const clear = await getPropertyClear({
        seedLocalId,
        seedUid,
        propertyId: groupId,
        propertyName: latest.propertyName,
      })
      if (!clear || (clear.retract && clear.retractScope.length === 0)) continue
    } else if (
      prevWithUid &&
      (await propertyValuesEqual(
        { dataType: property?.dataType, refValueType: property?.refValueType ?? undefined },
        latest.propertyValue,
        prevWithUid.propertyValue,
        appDb,
      ))
    ) {
      // Back to the published value: the outbox drops such a draft when it applies
      continue
    }
    pendingProperties.push({
      propertyName: property?.storageName ?? latest.propertyName,
      currentValue: latest.propertyValue ?? null,
      previousPublishedValue: prevWithUid?.propertyValue ?? null,
      pending: true,
      change: !isEmpty ? 'set' : latest.retract ? 'retracted' : 'removed',
    })
  }

  pendingProperties.sort((a, b) => a.propertyName.localeCompare(b.propertyName))

  let lastPublishedVersionUid: string | null = null
  let lastVersionPublishedAt: number | null = null

  if (seedLocalId) {
    const published = await getLatestPublishedVersionRow(seedLocalId)
    if (published) {
      lastPublishedVersionUid = published.uid
      if (published.attestationCreatedAt != null) {
        lastVersionPublishedAt = published.attestationCreatedAt
      }
    }
  }

  return {
    pendingProperties,
    lastPublishedVersionUid,
    lastVersionPublishedAt,
  }
}
